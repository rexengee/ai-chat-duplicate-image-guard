(() => {
  if (window.__AI_DUP_GUARD_CONTENT_INIT__) return;
  window.__AI_DUP_GUARD_CONTENT_INIT__ = true;

  const BRIDGE_CHANNEL = "__AI_DUP_GUARD_INJECT_FILES__";
  const QUEUE_TTL_MS = 10000;
  const GENERIC_CLIPBOARD_BASE_NAMES = new Set(["", "image", "resim", "clipboard", "pasted"]);
  const MIME_PRIORITY = ["image/png", "image/webp", "image/jpeg", "image/gif", "image/bmp"];

  const activeDraftHashes = new Set();
  const activeDraftSizeTypeCounts = new Map();
  const pendingHashPromises = new Set();
  const pendingAttachmentQueue = [];
  const trackedPreviewElements = new Map();

  let lastPasteEditor = null;

  const addSizeType = (key) =>
    activeDraftSizeTypeCounts.set(key, (activeDraftSizeTypeCounts.get(key) || 0) + 1);

  const removeSizeType = (key) => {
    const count = activeDraftSizeTypeCounts.get(key) || 0;
    count <= 1
      ? activeDraftSizeTypeCounts.delete(key)
      : activeDraftSizeTypeCounts.set(key, count - 1);
  };

  const hasSizeType = (key) => (activeDraftSizeTypeCounts.get(key) || 0) > 0;

  async function computeSha256(file) {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function showToast(message) {
    document.getElementById("ai-dup-guard-toast")?.remove();
    const toast = document.createElement("div");
    toast.id = "ai-dup-guard-toast";
    toast.textContent = message;
    Object.assign(toast.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      background: "#1f2937",
      color: "#f9fafb",
      padding: "10px 16px",
      borderRadius: "8px",
      fontSize: "13px",
      fontFamily: "system-ui, sans-serif",
      boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
      zIndex: "999999"
    });
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  function removeAttachmentEntry(meta) {
    if (!meta) return;
    activeDraftHashes.delete(meta.hash);
    removeSizeType(meta.sizeTypeKey);
  }

  function resetDraftState() {
    activeDraftHashes.clear();
    activeDraftSizeTypeCounts.clear();
    pendingHashPromises.clear();
    pendingAttachmentQueue.length = 0;
    trackedPreviewElements.clear();
  }

  function pruneExpiredQueue(now = Date.now()) {
    while (pendingAttachmentQueue.length > 0 && pendingAttachmentQueue[0].expiresAt < now) {
      pendingAttachmentQueue.shift();
    }
  }

  function registerAttachment(hash, sizeTypeKey) {
    activeDraftHashes.add(hash);
    addSizeType(sizeTypeKey);
    pruneExpiredQueue();
    pendingAttachmentQueue.push({ hash, sizeTypeKey, expiresAt: Date.now() + QUEUE_TTL_MS });
  }

  function resolveElement(target) {
    const el = target instanceof Element ? target : target?.parentElement;
    return el instanceof HTMLElement ? el : null;
  }

  function getActiveEditor() {
    if (lastPasteEditor instanceof HTMLElement && lastPasteEditor.isConnected) {
      return lastPasteEditor;
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && (active.isContentEditable || active.tagName === "TEXTAREA")) {
      return active;
    }
    const editors = document.querySelectorAll(
      'rich-textarea [contenteditable="true"], [contenteditable="true"], textarea'
    );
    return editors.length > 0 ? editors[editors.length - 1] : null;
  }

  function getComposerRoot() {
    const editor = getActiveEditor();
    if (!editor) return null;

    let node = editor.parentElement;
    let bestContainer = editor.parentElement;

    for (let depth = 0; depth < 14 && node && node !== document.body; depth++) {
      if (
        node.querySelector(
          '[data-testid="user-message"], [data-message-author-role], message-content, .font-claude-response'
        )
      ) {
        break;
      }
      bestContainer = node;
      if (node.tagName === "FORM" || node.tagName === "FIELDSET") break;
      node = node.parentElement;
    }
    return bestContainer;
  }

  function isPreviewMediaElement(el, composerRoot) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;

    if (el.tagName === "IMG") {
      const src = (el.getAttribute("src") || "").trim();
      if (!src) return false;
      if (src.startsWith("blob:") || src.startsWith("data:image/")) return true;
      return Boolean(composerRoot?.contains(el)) && /^https?:\/\//i.test(src);
    }

    const bg = el.style?.backgroundImage || "";
    return bg.includes("blob:") || bg.includes("data:image/");
  }

  function countPreviewMediaInNode(container, composerRoot) {
    let count = 0;
    const nodes = container.querySelectorAll("img, [style*='blob:'], [style*='data:image/']");
    for (const n of nodes) {
      if (isPreviewMediaElement(n, composerRoot)) {
        count++;
        if (count > 1) return count;
      }
    }
    return count;
  }

  // En fazla 4 seviye yukarı çıkar; editörü, birden fazla görseli veya araç çubuğunu asla seçmez
  function getSafePreviewTarget(mediaEl, composerRoot) {
    if (!composerRoot) return mediaEl;
    const editor = getActiveEditor();
    let node = mediaEl.parentElement;

    for (let depth = 0; depth < 4 && node && node !== composerRoot && composerRoot.contains(node); depth++) {
      if (editor && node.contains(editor)) break;
      if (countPreviewMediaInNode(node, composerRoot) > 1) break;

      const buttons = node.querySelectorAll('button, [role="button"]');
      if (buttons.length >= 1 && buttons.length <= 2) {
        return node;
      }
      node = node.parentElement;
    }
    return mediaEl;
  }

  function isAlreadyTracked(el) {
    for (const trackedEl of trackedPreviewElements.keys()) {
      if (trackedEl === el || trackedEl.contains(el) || el.contains(trackedEl)) return true;
    }
    return false;
  }

  function bindNewPreviewElements(rootNode, composerRoot) {
    if (pendingAttachmentQueue.length === 0 || !(rootNode instanceof HTMLElement)) return;
    if (composerRoot && !composerRoot.contains(rootNode) && !rootNode.contains(composerRoot)) return;

    const candidates = [];
    if (isPreviewMediaElement(rootNode, composerRoot)) candidates.push(rootNode);
    rootNode.querySelectorAll("img, [style*='blob:'], [style*='data:image/']").forEach((el) => {
      if (isPreviewMediaElement(el, composerRoot)) candidates.push(el);
    });

    const now = Date.now();
    for (const mediaEl of candidates) {
      const targetEl = getSafePreviewTarget(mediaEl, composerRoot);
      if (isAlreadyTracked(targetEl)) continue;

      pruneExpiredQueue(now);
      if (pendingAttachmentQueue.length === 0) break;

      const meta = pendingAttachmentQueue.shift();
      trackedPreviewElements.set(targetEl, { hash: meta.hash, sizeTypeKey: meta.sizeTypeKey });
    }
  }

  function cleanupRemovedPreviews() {
    for (const [el, meta] of trackedPreviewElements.entries()) {
      if (!el.isConnected) {
        removeAttachmentEntry(meta);
        trackedPreviewElements.delete(el);
      }
    }
  }

  function extractClipboardImages(clipboardData) {
    const items = clipboardData?.items;
    if (!items) return [];

    const imageFiles = [];
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }

    if (imageFiles.length <= 1) return imageFiles;

    // Tek görselin panoda birden fazla MIME formatıyla (png + bmp/jpeg) tutulmasını ayıkla
    const distinctTypes = new Set(imageFiles.map((f) => f.type));
    const allGenericNames = imageFiles.every((f) => {
      const base = (f.name || "").replace(/\.[^.]+$/, "").trim().toLowerCase();
      return GENERIC_CLIPBOARD_BASE_NAMES.has(base);
    });

    if (allGenericNames && distinctTypes.size === imageFiles.length) {
      imageFiles.sort((a, b) => {
        const ia = MIME_PRIORITY.indexOf(a.type);
        const ib = MIME_PRIORITY.indexOf(b.type);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });
      return [imageFiles[0]];
    }

    return imageFiles;
  }

  function ensureUniqueFilenameForGemini(file) {
    if (location.hostname !== "gemini.google.com") return file;
    const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
    const uniqueName = `ss_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
    return new File([file], uniqueName, {
      type: file.type,
      lastModified: file.lastModified || Date.now()
    });
  }

  function injectFilesViaMainWorld(files) {
    const preparedFiles = files.map(ensureUniqueFilenameForGemini);
    const mode = location.hostname === "gemini.google.com" ? "drop" : "paste";
    window.postMessage({ type: BRIDGE_CHANNEL, mode, files: preparedFiles }, window.location.origin);
  }

  function isRemoveButtonLabel(label) {
    return (
      label.includes("remove") ||
      label.includes("delete") ||
      label.includes("kaldır") ||
      label.includes("sil") ||
      label.includes("close") ||
      label.includes("kapat")
    );
  }

  document.addEventListener(
    "paste",
    (event) => {
      if (event.__aiDupGuardFromBridge || event.wrappedJSObject?.__aiDupGuardFromBridge) return;

      const targetEl = resolveElement(event.target);
      if (targetEl) {
        lastPasteEditor =
          targetEl.closest('rich-textarea [contenteditable="true"], [contenteditable="true"], textarea') ||
          targetEl;
      }

      const imageFiles = extractClipboardImages(event.clipboardData);
      if (imageFiles.length === 0) return;

      const isGeminiWithExistingImage =
        location.hostname === "gemini.google.com" && activeDraftHashes.size > 0;

      const seenInCurrentPaste = new Set();
      const hasCandidateMatch = imageFiles.some((file) => {
        const key = `${file.size}:${file.type}`;
        if (hasSizeType(key) || seenInCurrentPaste.has(key)) return true;
        seenInCurrentPaste.add(key);
        return false;
      });

      if (!hasCandidateMatch && !isGeminiWithExistingImage) {
        for (const file of imageFiles) {
          const sizeTypeKey = `${file.size}:${file.type}`;
          const hashTask = computeSha256(file)
            .then((hash) => registerAttachment(hash, sizeTypeKey))
            .finally(() => pendingHashPromises.delete(hashTask));
          pendingHashPromises.add(hashTask);
        }
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      (async () => {
        if (pendingHashPromises.size > 0) {
          await Promise.allSettled(Array.from(pendingHashPromises));
        }

        const uniqueFiles = [];
        for (const file of imageFiles) {
          const hash = await computeSha256(file);
          if (activeDraftHashes.has(hash)) {
            showToast("Bu görsel zaten mevcut mesaja eklendi.");
          } else {
            const sizeTypeKey = `${file.size}:${file.type}`;
            registerAttachment(hash, sizeTypeKey);
            uniqueFiles.push(file);
          }
        }

        if (uniqueFiles.length > 0) {
          injectFilesViaMainWorld(uniqueFiles);
        }
      })();
    },
    true
  );

  let lastUrl = location.href;
  const domObserver = new MutationObserver((mutations) => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      resetDraftState();
      return;
    }

    pruneExpiredQueue();
    if (pendingAttachmentQueue.length === 0 && trackedPreviewElements.size === 0) return;

    const composerRoot = pendingAttachmentQueue.length > 0 ? getComposerRoot() : null;
    let hasRemovedNodes = false;

    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        if (mutation.removedNodes.length > 0) hasRemovedNodes = true;
        for (const added of mutation.addedNodes) {
          if (added instanceof HTMLElement) bindNewPreviewElements(added, composerRoot);
        }
      } else if (mutation.type === "attributes" && mutation.target instanceof HTMLElement) {
        bindNewPreviewElements(mutation.target, composerRoot);
      }
    }

    if (hasRemovedNodes && trackedPreviewElements.size > 0) {
      cleanupRemovedPreviews();
    }
  });

  domObserver.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["src", "style"]
  });

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        const targetEl = resolveElement(e.target);
        if (targetEl && targetEl.closest('[contenteditable="true"], textarea')) {
          resetDraftState();
        }
      }
    },
    true
  );

  document.addEventListener(
    "click",
    (e) => {
      const targetEl = resolveElement(e.target);
      const btn = targetEl?.closest('button, [role="button"]');
      if (!btn) return;

      const label = (
        btn.getAttribute("aria-label") ||
        btn.getAttribute("title") ||
        btn.getAttribute("data-testid") ||
        btn.textContent ||
        ""
      ).toLowerCase();

      for (const [cardEl, meta] of trackedPreviewElements.entries()) {
        if (cardEl.contains(btn) && isRemoveButtonLabel(label)) {
          removeAttachmentEntry(meta);
          trackedPreviewElements.delete(cardEl);
          return;
        }
      }

      const composerRoot = getComposerRoot();
      if (composerRoot && !composerRoot.contains(btn)) return;

      if (activeDraftHashes.size === 1 && isRemoveButtonLabel(label)) {
        resetDraftState();
        return;
      }

      if (label.includes("send") || label.includes("gönder") || label.includes("submit")) {
        resetDraftState();
      }
    },
    true
  );
})();