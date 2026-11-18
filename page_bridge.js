(() => {
  const BRIDGE_CHANNEL = "__AI_DUP_GUARD_INJECT_FILES__";

  function findEditorTarget() {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      (active.isContentEditable || active.tagName === "TEXTAREA")
    ) {
      return active;
    }
    return (
      document.querySelector('rich-textarea [contenteditable="true"]') ||
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector("textarea") ||
      document.body
    );
  }

  function dispatchPagePaste(target, files) {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));

    const pasteEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: dt
    });
    pasteEvent.__aiDupGuardFromBridge = true;
    target.dispatchEvent(pasteEvent);
  }

  function dispatchPageDrop(target, files) {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));

    const dropZone =
      target.closest("[xap-dropzone], [data-dropzone], form") || target;

    dropZone.dispatchEvent(
      new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: dt })
    );
    dropZone.dispatchEvent(
      new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt })
    );
    dropZone.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt })
    );
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== BRIDGE_CHANNEL || !Array.isArray(data.files)) return;

    const files = data.files;
    if (files.length === 0) return;

    const target = findEditorTarget();
    target.focus?.();

    if (data.mode === "drop") {
      dispatchPageDrop(target, files);
    } else {
      dispatchPagePaste(target, files);
    }
  });
})();