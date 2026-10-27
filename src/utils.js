"use strict";
/** Небольшие общие помощники: склонение, время, числа, миксины. */

function findTextIndex(text, needle, caseSensitive) {
    return caseSensitive
        ? text.indexOf(needle)
        : text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
}
function pluralRu(count, one, few, many) {
    const abs = Math.abs(count) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20)
        return many;
    if (last > 1 && last < 5)
        return few;
    if (last === 1)
        return one;
    return many;
}
function relativeTime(timestamp) {
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    if (minutes < 1)
        return "только что";
    if (minutes < 60)
        return `${minutes} мин назад`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours} ч назад`;
    return `${Math.floor(hours / 24)} д назад`;
}
function clampNumber(value, min, max, fallback) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
}
/** Copy methods of mixin classes onto `target.prototype`, so one class can be split across files. */
function applyMixins(target, ...mixins) {
    for (const mixin of mixins) {
        for (const name of Object.getOwnPropertyNames(mixin.prototype)) {
            if (name === "constructor")
                continue;
            Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(mixin.prototype, name));
        }
    }
}

/** Wrap visible mentions of `tag` in rendered Markdown with <mark class="tra-highlight">. */
function highlightTagInElement(container, tag, caseSensitive) {
    const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const flags = caseSensitive ? "gu" : "giu";
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_/#-])#?${escapedTag}(?![\\p{L}\\p{N}_/-])`, flags);
    const walker = document.createTreeWalker(container, 4 /* SHOW_TEXT */);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (!parent || parent.closest("code, pre, script, style, mark.tra-highlight"))
            continue;
        if (pattern.test(node.nodeValue ?? "")) {
            pattern.lastIndex = 0;
            textNodes.push(node);
        }
        pattern.lastIndex = 0;
    }
    for (const textNode of textNodes) {
        const text = textNode.nodeValue ?? "";
        const fragment = document.createDocumentFragment();
        let cursor = 0;
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            if (match.index > cursor)
                fragment.appendChild(document.createTextNode(text.slice(cursor, match.index)));
            const mark = document.createElement("mark");
            mark.className = "tra-highlight";
            mark.textContent = match[0];
            fragment.appendChild(mark);
            cursor = match.index + match[0].length;
            if (match[0].length === 0)
                pattern.lastIndex += 1;
        }
        if (cursor === 0)
            continue;
        if (cursor < text.length)
            fragment.appendChild(document.createTextNode(text.slice(cursor)));
        textNode.parentNode?.replaceChild(fragment, textNode);
    }
}

/** Show "Записи: k из n" on a card when only some records of the note are chosen. */
function updatePostBadge(card, selection) {
    const badge = card.querySelector(".tra-post-badge");
    if (!badge)
        return;
    if (selection) {
        badge.textContent = `Записи: ${selection.indices.length} из ${selection.meaningful ?? selection.count}`;
        badge.style.display = "";
    }
    else {
        badge.textContent = "";
        badge.style.display = "none";
    }
}

module.exports = { updatePostBadge, highlightTagInElement, findTextIndex, pluralRu, relativeTime, clampNumber, applyMixins };
