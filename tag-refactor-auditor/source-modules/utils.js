import * as tag_utils_1 from "./tag-utils.js";
function appendExcerptWithHighlight(parent, excerpt, tag, caseSensitive) {
    let index = (0, tag_utils_1.findInlineTagIndex)(excerpt, tag, caseSensitive);
    let matched = `#${tag}`;
    if (index < 0) {
        index = findTextIndex(excerpt, tag, caseSensitive);
        matched = tag;
    }
    if (index < 0) {
        parent.appendText(excerpt);
        return;
    }
    parent.appendText(excerpt.slice(0, index));
    parent.createEl("mark", { text: excerpt.slice(index, index + matched.length), cls: "tra-highlight" });
    parent.appendText(excerpt.slice(index + matched.length));
}
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

export { appendExcerptWithHighlight, findTextIndex, pluralRu, relativeTime, clampNumber };
