import * as tag_utils_1 from "./tag-utils.js";
function isIgnoredPath(path, ignoredFolders) {
    const normalizedPath = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return ignoredFolders.some((folder) => {
        const normalizedFolder = folder.replace(/\\/g, "/").trim().replace(/^\/+|\/+$/g, "");
        return normalizedFolder.length > 0 &&
            (normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`));
    });
}
function scanTagIndex(app, settings) {
    const result = new Map();
    const files = app.vault.getMarkdownFiles()
        .filter((file) => !isIgnoredPath(file.path, settings.ignoredFolders))
        .sort((a, b) => a.path.localeCompare(b.path));
    for (const file of files) {
        const cache = app.metadataCache.getFileCache(file);
        if (!cache)
            continue;
        // Keep one canonical tag per identity in each note. In case-insensitive
        // mode #Project and #project in one file must still count as one occurrence.
        const tagsInFile = new Map();
        for (const cachedTag of cache.tags ?? []) {
            const normalized = (0, tag_utils_1.normalizeTag)(cachedTag.tag);
            if (normalized) {
                const key = (0, tag_utils_1.tagKey)(normalized, settings.caseSensitive);
                if (!tagsInFile.has(key))
                    tagsInFile.set(key, normalized);
            }
        }
        for (const frontmatterTag of (0, tag_utils_1.collectFrontmatterTags)(cache.frontmatter)) {
            const key = (0, tag_utils_1.tagKey)(frontmatterTag, settings.caseSensitive);
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
    return new Map([...result.entries()].sort(([, a], [, b]) => a.tag.localeCompare(b.tag, undefined, {
        sensitivity: settings.caseSensitive ? "variant" : "base",
        numeric: true,
    })));
}
function tagCountForFiles(index) {
    let total = 0;
    for (const info of index.values())
        total += info.files.length;
    return total;
}
function filesAffectedByTags(index, tags, caseSensitive) {
    const files = new Map();
    for (const tag of tags) {
        const info = index.get((0, tag_utils_1.tagKey)(tag, caseSensitive));
        if (!info)
            continue;
        for (const file of info.files)
            files.set(file.path, file);
    }
    return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export { isIgnoredPath, scanTagIndex, tagCountForFiles, filesAffectedByTags };
