"use strict";
/** Построение индекса тегов из кэша метаданных Obsidian. */
const { collectFrontmatterTags } = require("./tags/frontmatter.js");
const { normalizeTag, tagKey } = require("./tags/tag-name.js");

// Same ordering as String#localeCompare, but without re-creating locale data per call.
const PATH_COLLATOR = new Intl.Collator();
function normalizeFolderPath(path) {
    return path.replace(/\\/g, "/").trim().replace(/^\/+|\/+$/g, "");
}
function isIgnoredPath(path, ignoredFolders) {
    const normalizedPath = normalizeFolderPath(path);
    return ignoredFolders.some((folder) => {
        const normalizedFolder = normalizeFolderPath(folder);
        return normalizedFolder.length > 0 &&
            (normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`));
    });
}
/** Build an `isIgnored(path)` predicate with the folder list normalized once. */
function makeIgnoredPathMatcher(ignoredFolders) {
    const folders = (ignoredFolders ?? []).map(normalizeFolderPath).filter(Boolean);
    if (folders.length === 0)
        return () => false;
    const prefixes = folders.map((folder) => `${folder}/`);
    return (path) => {
        const normalizedPath = normalizeFolderPath(path);
        for (let i = 0; i < folders.length; i += 1) {
            if (normalizedPath === folders[i] || normalizedPath.startsWith(prefixes[i]))
                return true;
        }
        return false;
    };
}
function makeTagCollator(caseSensitive) {
    return new Intl.Collator(undefined, { sensitivity: caseSensitive ? "variant" : "base", numeric: true });
}
function scanTagIndex(app, settings) {
    const result = new Map();
    const isIgnored = makeIgnoredPathMatcher(settings.ignoredFolders);
    const files = app.vault.getMarkdownFiles()
        .filter((file) => !isIgnored(file.path))
        .sort((a, b) => PATH_COLLATOR.compare(a.path, b.path));
    for (const file of files) {
        const cache = app.metadataCache.getFileCache(file);
        if (!cache)
            continue;
        // Keep one canonical tag per identity in each note. In case-insensitive
        // mode #Project and #project in one file must still count as one occurrence.
        const tagsInFile = new Map();
        for (const cachedTag of cache.tags ?? []) {
            const normalized = normalizeTag(cachedTag.tag);
            if (normalized) {
                const key = tagKey(normalized, settings.caseSensitive);
                if (!tagsInFile.has(key))
                    tagsInFile.set(key, normalized);
            }
        }
        for (const frontmatterTag of collectFrontmatterTags(cache.frontmatter)) {
            const key = tagKey(frontmatterTag, settings.caseSensitive);
            if (!tagsInFile.has(key))
                tagsInFile.set(key, frontmatterTag);
        }
        for (const [key, tag] of tagsInFile) {
            let info = result.get(key);
            if (!info) {
                info = { tag, key, files: [] };
                result.set(key, info);
            }
            info.files.push(file);
        }
    }
    const collator = makeTagCollator(settings.caseSensitive);
    return new Map([...result.entries()].sort(([, a], [, b]) => collator.compare(a.tag, b.tag)));
}
/** path -> tags of that note, in catalog order. */
function buildFileTagMap(index) {
    const map = new Map();
    for (const info of index.values()) {
        for (const file of info.files) {
            let tags = map.get(file.path);
            if (!tags) {
                tags = [];
                map.set(file.path, tags);
            }
            tags.push(info.tag);
        }
    }
    return map;
}
/** True when two indexes contain the same tags in the same notes. */
function sameTagIndex(a, b) {
    if (a.size !== b.size)
        return false;
    for (const [key, info] of a) {
        const other = b.get(key);
        if (!other || other.tag !== info.tag || other.files.length !== info.files.length)
            return false;
        for (let i = 0; i < info.files.length; i += 1) {
            if (info.files[i] !== other.files[i] && info.files[i].path !== other.files[i].path)
                return false;
        }
    }
    return true;
}
function tagCountForFiles(index) {
    let total = 0;
    for (const info of index.values())
        total += info.files.length;
    return total;
}

module.exports = { makeIgnoredPathMatcher, scanTagIndex, buildFileTagMap, sameTagIndex };
