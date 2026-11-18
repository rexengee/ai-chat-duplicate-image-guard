(() => {
  const BRIDGE_CHANNEL = "__AI_DUP_GUARD_INJECT_FILES__";

  const activeDraftHashes = new Set();
  const activeDraftSizeTypeCounts = new Map();
  const pendingHashPromises = new Set();
  const pendingAttachmentQueue = [];
  const trackedPreviewElements = new Map();
  const unconfirmedEntries = new Map();

  let lastPasteEditor = null;

  const addSizeType = (key) =>
    activeDraftSizeTypeCounts.set(key, (activeDraftSizeTypeCounts.get(key) || 0) + 1);

  const removeSizeType = (key) => {
    const count = activeDraftSizeTypeCounts.get(key) || 0;
    count <= 1 ? activeDraftSizeTypeCounts.delete(key) : activeDraftSizeTypeCounts.set(key, count - 1);
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

  function clearUnconfirmedTimer(hash) {
    const entry = unconfirmedEntries.get(hash);
    if (entry) {
      clearTimeout(entry.timerId);
      unconfirmedEntries.delete(hash);
    }
  }

  function removeAttachmentEntry(meta) {
    if (!meta) return;
    clearUnconfirmedTimer(meta.hash);
    activeDraftHashes.delete(meta.hash);
    removeSizeType(meta.sizeTypeKey);
  }

  function rollbackUnconfirmedHash(hash) {
    const entry = unconfirmedEntries.get(hash);
    if (!entry) return;
    removeAttachmentEntry({ hash, sizeTypeKey: entry.sizeTypeKey });
    const qIdx = pendingAttachmentQueue.findIndex((item) => item.hash === hash);
    if (qIdx !== -1) pendingAttachmentQueue.splice(qIdx, 1);
  }

  function resetDraftState() {
    for (const entry of unconfirmedEntries.values()) clearTimeout(entry.timerId);
    unconfirmedEntries.clear();
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

  function registerAttachment(hash, sizeTypeKey, { requireConfirmation = false } = {}) {
    activeDraftHashes.add(hash);
    addSizeType(sizeTypeKey);
    pruneExpiredQueue();

    pendingAttachmentQueue.push({ hash, sizeTypeKey, expiresAt: Date.now() + 3000 });
    clearUnconfirmedTimer(hash);

    if (requireConfirmation) {
      const timerId = setTimeout(() => rollbackUnconfirmedHash(hash), 2000);
      unconfirmedEntries.set(hash, { sizeTypeKey, timerId });
    }
  }

  function getActiveEditor() {
    if (lastPasteEditor instanceof HTMLElement && document.contains(lastPasteEditor)) {
      return lastPasteEditor;
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && (active.isContentEditable || active.tagName === "TEXTAREA")) {
      return active;
    }
    const editors = document.querySelectorAll('rich-textarea [contenteditable="true"], [contenteditable="true"], textarea');
    return editors.length > 0 ? editors[editors.length - 1] : null;
  }

  function getComposerRoot() {
    const editor = getActiveEditor();
    if (!editor) return null;

    let node = editor.parentElement;
    let bestContainer = editor.parentElement;

    for (let depth = 0; depth < 14 && node && node !== document.body; depth++) {
      if (node.querySelector('[data-testid="user-message"], [data-message-author-role], message-content, .font-claude-response')) {
        break;
      }
      bestContainer = node;
      if (node.tagName === "FORM" || node.tagName === "FIELDSET") break;
      node = node.parentElement;
    }
    return bestContainer;
  }

  function getRemovableCardElement(mediaEl, composerRoot) {
    if (!composerRoot) return mediaEl;
    let node = mediaEl.parentElement;
    while (node && node !== composerRoot && composerRoot.contains(node)) {
      if (node.querySelector("button")) return node;
      node = node.parentElement;
    }
    return mediaEl;
  }

  function isPreviewMediaElement(el, composerRoot) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.tagName === "IMG") {
      const src = el.getAttribute("src") || "";
      return src.startsWith("blob:") || src.startsWith("data:image/") || Boolean(composerRoot?.contains(el));
    }
    const bg = el.style?.backgroundImage || "";
    return bg.includes("blob:") || bg.includes("data:image/");
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
      const cardEl = getRemovableCardElement(mediaEl, composerRoot);
      if (isAlreadyTracked(cardEl)) continue;

      pruneExpiredQueue(now);
      if (pendingAttachmentQueue.length === 0) break;

      const meta = pendingAttachmentQueue.shift();
      clearUnconfirmedTimer(meta.hash);
      trackedPreviewElements.set(cardEl, { hash: meta.hash, sizeTypeKey: meta.sizeTypeKey });
    }
  }

  function cleanupRemovedPreviews() {
    for (const [el, meta] of trackedPreviewElements.entries()) {
      if (!document.contains(el)) {
        removeAttachmentEntry(meta);
        trackedPreviewElements.delete(el);
      }
    }
  }

  function ensureUniqueFilenameForGemini(file) {
    if (location.hostname !== "gemini.google.com") return file;
    const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
    const uniqueName = `ss_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
    return new File([file], uniqueName, { type: file.type, lastModified: file.lastModified || Date.now() });
  }

  async function injectFilesViaMainWorld(files, trackedHashes) {
    const preparedFiles = files.map(ensureUniqueFilenameForGemini);

    if (location.hostname === "gemini.google.com") {
      window.postMessage({ type: BRIDGE_CHANNEL, mode: "drop", files: preparedFiles }, "*");
      return;
    }

    window.postMessage({ type: BRIDGE_CHANNEL, mode: "paste", files: preparedFiles }, "*");
    await new Promise((resolve) => setTimeout(resolve, 400));

    if (trackedHashes.some((h) => unconfirmedEntries.has(h))) {
      window.postMessage({ type: BRIDGE_CHANNEL, mode: "drop", files: preparedFiles }, "*");
    }
  }

  document.addEventListener(
    "paste",
    (event) => {
      if (event.__aiDupGuardFromBridge || event.wrappedJSObject?.__aiDupGuardFromBridge) return;

      if (event.target instanceof HTMLElement) {
        lastPasteEditor = event.target.closest('[contenteditable="true"], textarea') || event.target;
      }

      const items = event.clipboardData?.items;
      if (!items) return;

      const imageFiles = [];
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
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
            .then((hash) => registerAttachment(hash, sizeTypeKey, { requireConfirmation: false }))
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
        const uniqueHashes = [];
        for (const file of imageFiles) {
          const hash = await computeSha256(file);
          if (activeDraftHashes.has(hash)) {
            showToast("Bu görsel zaten mevcut mesaja eklendi.");
          } else {
            const sizeTypeKey = `${file.size}:${file.type}`;
            registerAttachment(hash, sizeTypeKey, { requireConfirmation: true });
            uniqueFiles.push(file);
            uniqueHashes.push(hash);
          }
        }

        if (uniqueFiles.length > 0) {
          await injectFilesViaMainWorld(uniqueFiles, uniqueHashes);
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
        const target = e.target;
        if (target instanceof HTMLElement && (target.isContentEditable || target.tagName === "TEXTAREA")) {
          resetDraftState();
        }
      }
    },
    true
  );

  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;

      for (const [cardEl, meta] of trackedPreviewElements.entries()) {
        if (cardEl.contains(btn)) {
          removeAttachmentEntry(meta);
          trackedPreviewElements.delete(cardEl);
          return;
        }
      }

      const label = (
        btn.getAttribute("aria-label") ||
        btn.getAttribute("title") ||
        btn.getAttribute("data-testid") ||
        btn.textContent ||
        ""
      ).toLowerCase();

      if (
        activeDraftHashes.size === 1 &&
        (label.includes("remove") || label.includes("delete") || label.includes("kaldır") || label.includes("sil"))
      ) {
        if (getComposerRoot()?.contains(btn)) {
          resetDraftState();
          return;
        }
      }

      if (label.includes("send") || label.includes("gönder") || label.includes("submit")) {
        resetDraftState();
      }
    },
    true
  );
})();