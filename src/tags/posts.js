"use strict";
/**
 * Записи внутри заметки: фрагменты текста между разделителями `---`
 * (так устроены экспорты ЖЖ и Telegram). Фронтматтер записью не считается.
 */
const { matchFrontmatter } = require("./frontmatter.js");
const { splitMarkdownPostSegments } = require("./markdown.js");

function splitNote(content) {
    const match = matchFrontmatter(content);
    const head = match ? match.whole : "";
    const segments = splitMarkdownPostSegments(content.slice(head.length));
    return { head, segments };
}

/**
 * Records of a note, numbered from 0 in document order (empty ones included,
 * so the numbering is stable). `count` is used to detect later edits.
 */
function listPosts(content) {
    const { segments } = splitNote(content);
    const posts = [];
    for (const segment of segments) {
        if (segment.type === "post")
            posts.push({ index: posts.length, text: segment.text, isEmpty: segment.text.trim() === "" });
    }
    return { posts, count: posts.length };
}

/** Number of non-empty records; a note with fewer than two has nothing to choose. */
function countMeaningfulPosts(content) {
    return listPosts(content).posts.filter((post) => !post.isEmpty).length;
}

/**
 * Apply `transform(text, index)` only to the records whose indices are in
 * `indices`; separators, other records and the frontmatter stay untouched.
 */
function applyToPosts(content, indices, transform) {
    const { head, segments } = splitNote(content);
    let index = -1;
    for (const segment of segments) {
        if (segment.type !== "post")
            continue;
        index += 1;
        if (indices.has(index))
            segment.text = transform(segment.text, index);
    }
    return `${head}${segments.map((segment) => segment.text).join("")}`;
}

/**
 * Wrap a whole-note transform so it respects a record selection
 * `{ indices: number[], count: number }`. Throws when the note has a different
 * number of records than when they were chosen.
 */
function transformPostsOrNote(content, postSelection, wholeNote, perPost) {
    if (!postSelection)
        return wholeNote(content);
    const { count } = listPosts(content);
    if (count !== postSelection.count)
        throw new Error("записи в заметке изменились после выбора — выберите их заново");
    return applyToPosts(content, new Set(postSelection.indices), perPost);
}

module.exports = { listPosts, countMeaningfulPosts, applyToPosts, transformPostsOrNote };
