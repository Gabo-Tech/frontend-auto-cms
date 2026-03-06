import type { CmsContentFile, CmsNode } from "../shared/types.js";

function keyFromPath(path: string): string {
  return path.replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
}

function buildSelector(el: Element): string {
  const id = el.getAttribute("id");
  if (id) {
    return `#${id}`;
  }
  const className = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)[0];
  if (className) {
    return `${el.tagName.toLowerCase()}.${className}`;
  }
  return el.tagName.toLowerCase();
}

function isSkippableElement(el: Element): boolean {
  return ["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME"].includes(el.tagName);
}

function meaningfulText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function getOrCreateTextAnchor(targetDocument: Document, textNode: Text, key: string): Element | null {
  const parent = textNode.parentElement;
  if (!parent || isSkippableElement(parent)) {
    return null;
  }

  const visibleTextNodes = Array.from(parent.childNodes).filter(
    (n) => n.nodeType === Node.TEXT_NODE && meaningfulText(n.nodeValue).length > 0
  );
  if (visibleTextNodes.length === 1 && parent.children.length === 0) {
    parent.setAttribute("data-cms-key", key);
    return parent;
  }

  const span = targetDocument.createElement("span");
  span.textContent = textNode.nodeValue ?? "";
  span.setAttribute("data-cms-key", key);
  textNode.parentNode?.replaceChild(span, textNode);
  return span;
}

export function scanDom(targetDocument: Document = document, pagePath?: string): CmsContentFile {
  const nodes: CmsNode[] = [];
  let textIndex = 0;
  let mediaIndex = 0;
  let sectionIndex = 0;
  let propertyIndex = 0;
  const pathName = pagePath ?? targetDocument.location?.pathname ?? location.pathname;
  const root = targetDocument.body;
  if (!root) {
    return {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes
    };
  }

  const walker = targetDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const current = walker.currentNode;

    if (current.nodeType === Node.TEXT_NODE) {
      const textNode = current as Text;
      const text = meaningfulText(textNode.nodeValue);
      if (text.length < 2) {
        continue;
      }
      textIndex += 1;
      const key = `${keyFromPath(pathName || "index")}.text.${textIndex}`;
      const anchor = getOrCreateTextAnchor(targetDocument, textNode, key);
      if (!anchor) {
        continue;
      }
      nodes.push({
        id: `dom_txt_${textIndex}`,
        key,
        type: "text",
        label: buildSelector(anchor),
        value: text,
        selector: buildSelector(anchor),
        sourceRefs: [{ file: pathName, original: text }]
      });
      continue;
    }

    const el = current as Element;
    if (isSkippableElement(el)) {
      continue;
    }

    const tag = el.tagName.toLowerCase();
    if (tag === "img" || tag === "video") {
      const src = el.getAttribute("src") ?? "";
      if (src) {
        mediaIndex += 1;
        const key = `${keyFromPath(pathName || "index")}.${tag}.${mediaIndex}`;
        el.setAttribute("data-cms-key", key);
        nodes.push({
          id: `dom_media_${mediaIndex}`,
          key,
          type: tag === "img" ? "image" : "video",
          label: buildSelector(el),
          value: src,
          selector: buildSelector(el),
          attrs: { src, alt: el.getAttribute("alt") ?? "" },
          sourceRefs: [{ file: pathName, original: src }]
        });
      }
    }

    if (["section", "ul", "ol"].includes(tag) || el.hasAttribute("data-repeatable")) {
      const items = Array.from(el.children).map((child) => meaningfulText(child.textContent)).filter(Boolean);
      if (items.length >= 2) {
        sectionIndex += 1;
        const key = `${keyFromPath(pathName || "index")}.section.${sectionIndex}`;
        el.setAttribute("data-cms-key", key);
        nodes.push({
          id: `dom_sec_${sectionIndex}`,
          key,
          type: "section",
          label: buildSelector(el),
          value: items.join(" | "),
          selector: buildSelector(el),
          sectionItems: items,
          sourceRefs: [{ file: pathName, original: el.innerHTML }]
        });
      }
    }

    const attrs: Record<string, string> = {};
    ["alt", "href", "src", "aria-label", "title"].forEach((attr) => {
      const value = el.getAttribute(attr);
      if (value != null && value.trim()) {
        attrs[attr] = value;
      }
    });
    const hasAttrs = Object.keys(attrs).length > 0;
    const isMediaElement = tag === "img" || tag === "video";
    if (hasAttrs && !isMediaElement) {
      propertyIndex += 1;
      const key = `${keyFromPath(pathName || "index")}.property.${propertyIndex}`;
      nodes.push({
        id: `dom_prop_${propertyIndex}`,
        key,
        type: "property",
        label: buildSelector(el),
        value: JSON.stringify(attrs),
        selector: buildSelector(el),
        attrs,
        sourceRefs: [{ file: pathName, original: JSON.stringify(attrs) }]
      });
    }
  }

  return {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes
  };
}

export function applyNodeToDom(node: CmsNode, targetDocument: Document = document): void {
  if (!node.key) {
    return;
  }
  const target = targetDocument.querySelector(`[data-cms-key="${CSS.escape(node.key)}"]`);
  if (!target) {
    return;
  }

  if (node.type === "text") {
    target.textContent = node.value;
  } else if (node.type === "image" || node.type === "video") {
    (target as HTMLImageElement | HTMLVideoElement).src = node.value;
    if (node.attrs?.alt != null) {
      target.setAttribute("alt", node.attrs.alt);
    }
  } else if (node.type === "property" && node.attrs) {
    Object.entries(node.attrs).forEach(([k, v]) => target.setAttribute(k, v));
  } else if (node.type === "section" && node.sectionItems) {
    const children = Array.from(target.children);
    node.sectionItems.forEach((item, idx) => {
      if (children[idx]) {
        children[idx].textContent = item;
      }
    });
  }
}
