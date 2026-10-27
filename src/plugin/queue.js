"use strict";
/** Очередь изменений тегов. */
const { Notice } = require("obsidian");
const { pluralRu } = require("../utils.js");
const { cleanTagInput, isValidTag, normalizeTag, tagKey } = require("../tags/tag-name.js");

/** Методы подмешиваются в TagRefactorAuditorPlugin. */
class QueueMixin {
    getTagInfo(tag) {
        return this.tagIndex.get(tagKey(tag, this.settings.caseSensitive));
    }
    getPendingChanges() {
        return [...this.pendingChanges.values(), ...this.pendingAdditions.values()];
    }
    /** Notes a change applies to: all notes with its tag, or only `change.paths`. */
    filesForChange(change) {
        const files = this.getTagInfo(change.oldTag)?.files ?? [];
        if (!Array.isArray(change.paths))
            return files;
        const allowed = new Set(change.paths);
        return files.filter((file) => allowed.has(file.path));
    }
    affectedFiles(changes = this.getPendingChanges()) {
        const files = new Map();
        for (const change of changes) {
            for (const file of this.filesForChange(change))
                files.set(file.path, file);
        }
        return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
    }
    /** Changes that should be applied to one note (respecting per-change note selection). */
    changesForFile(changes, file) {
        return changes.filter((change) => !Array.isArray(change.paths) || change.paths.includes(file.path));
    }
    /**
     * Convert a note selection into the stored scope: undefined means "all notes
     * with the tag" (so notes tagged later are included), an array limits it.
     * Returns null when nothing is selected.
     */
    resolveScope(info, paths, postSelections = null) {
        const selected = paths ? info.files.filter((file) => paths.has(file.path)).map((file) => file.path) : info.files.map((file) => file.path);
        if (selected.length === 0) {
            new Notice("Отметьте хотя бы одну заметку, к которой применить изменение.");
            return null;
        }
        // Chosen records (`{ indices, count }`) of the selected notes only.
        let posts;
        if (postSelections) {
            const selectedSet = new Set(selected);
            for (const [path, selection] of postSelections) {
                if (selectedSet.has(path)) {
                    posts ??= {};
                    posts[path] = { indices: [...selection.indices], count: selection.count };
                }
            }
        }
        return { paths: selected.length === info.files.length ? undefined : selected, posts };
    }
    scopeLabel(scope, info) {
        const parts = [];
        if (scope.paths)
            parts.push(`${scope.paths.length} из ${info.files.length} ${pluralRu(info.files.length, "заметки", "заметок", "заметок")}`);
        const withPosts = scope.posts ? Object.keys(scope.posts).length : 0;
        if (withPosts)
            parts.push(`выбранные записи в ${withPosts} ${pluralRu(withPosts, "заметке", "заметках", "заметках")}`);
        return parts.length ? ` (${parts.join(", ")})` : "";
    }
    addOrUpdateChange(oldTagValue, newTagValue, paths = null, posts = null) {
        const oldTag = normalizeTag(oldTagValue);
        const newTag = normalizeTag(cleanTagInput(newTagValue));
        if (!oldTag || !newTag) {
            new Notice("Укажите старый и новый теги.");
            return false;
        }
        if (!isValidTag(newTag)) {
            new Notice("Имя тега может содержать буквы, цифры, `_`, `-` и `/` для вложенности. Пробелы не поддерживаются.");
            return false;
        }
        const oldKey = tagKey(oldTag, this.settings.caseSensitive);
        if (oldKey === tagKey(newTag, this.settings.caseSensitive)) {
            new Notice("Старое и новое имена тегов совпадают.");
            return false;
        }
        if (!this.tagIndex.has(oldKey)) {
            new Notice(`Тег #${oldTag} больше не найден. Обновите список тегов.`);
            return false;
        }
        const info = this.tagIndex.get(oldKey);
        const scope = this.resolveScope(info, paths, posts);
        if (!scope)
            return false;
        this.pendingChanges.set(oldKey, { oldTag: info.tag, newTag, action: "rename", paths: scope.paths, posts: scope.posts });
        this.refreshViews();
        return true;
    }
    addMultipleTagsChange(sourceTagValue, rawTagsValue, paths = null, posts = null) {
        const sourceTag = normalizeTag(sourceTagValue);
        const rawTags = typeof rawTagsValue === "string" ? rawTagsValue : "";
        const requestedTags = rawTags.split(/[\s,;]+/).map((value) => cleanTagInput(value)).filter(Boolean);
        if (!sourceTag || requestedTags.length === 0) {
            new Notice("Укажите один или несколько новых тегов.");
            return false;
        }
        const oldKey = tagKey(sourceTag, this.settings.caseSensitive);
        const info = this.tagIndex.get(oldKey);
        if (!info) {
            new Notice(`Тег #${sourceTag} больше не найден. Обновите список тегов.`);
            return false;
        }
        const scope = this.resolveScope(info, paths, posts);
        if (!scope)
            return false;
        const previous = this.pendingAdditions.get(oldKey);
        // A different note selection starts a new addition instead of merging.
        const sameScope = previous && JSON.stringify([previous.paths ?? null, previous.posts ?? null]) === JSON.stringify([scope.paths ?? null, scope.posts ?? null]);
        const existingPending = sameScope ? previous.addTags : [];
        const allTags = [...existingPending];
        const seen = new Set(allTags.map((tag) => tagKey(tag, this.settings.caseSensitive)));
        for (const tagValue of requestedTags) {
            const tag = normalizeTag(tagValue);
            if (!tag || !isValidTag(tag)) {
                new Notice(`Некорректное имя тега: ${tagValue}. Используйте буквы, цифры, \`_\`, \`-\` и \`/\` для вложенности.`);
                return false;
            }
            const key = tagKey(tag, this.settings.caseSensitive);
            if (key === oldKey) {
                new Notice(`Тег #${tag} уже выбран как исходный; его не нужно добавлять повторно.`);
                continue;
            }
            if (seen.has(key))
                continue;
            seen.add(key);
            allTags.push(tag);
        }
        if (allTags.length === existingPending.length) {
            new Notice("Все указанные теги уже есть в очереди или совпадают с исходным тегом.");
            return false;
        }
        this.pendingAdditions.set(oldKey, {
            oldTag: info.tag,
            newTag: null,
            action: "add",
            addTags: allTags,
            paths: scope.paths,
            posts: scope.posts,
        });
        new Notice(`Добавление тегов к заметкам с #${info.tag}${this.scopeLabel(scope, info)} добавлено в очередь.`);
        this.refreshViews();
        return true;
    }
    addDeleteTagChange(oldTagValue, paths = null, posts = null) {
        const oldTag = normalizeTag(oldTagValue);
        if (!oldTag) {
            new Notice("Не удалось определить тег для удаления.");
            return false;
        }
        const oldKey = tagKey(oldTag, this.settings.caseSensitive);
        const info = this.tagIndex.get(oldKey);
        if (!info) {
            new Notice(`Тег #${oldTag} больше не найден. Обновите список тегов.`);
            return false;
        }
        const scope = this.resolveScope(info, paths, posts);
        if (!scope)
            return false;
        this.pendingChanges.set(oldKey, { oldTag: info.tag, newTag: null, action: "delete", paths: scope.paths, posts: scope.posts });
        new Notice(`Удаление #${info.tag}${this.scopeLabel(scope, info)} добавлено в очередь.`);
        this.refreshViews();
        return true;
    }
    addUnmarkTagChange(oldTagValue, paths = null, posts = null) {
        const oldTag = normalizeTag(oldTagValue);
        if (!oldTag) {
            new Notice("Не удалось определить тег для снятия маркировки.");
            return false;
        }
        const oldKey = tagKey(oldTag, this.settings.caseSensitive);
        const info = this.tagIndex.get(oldKey);
        if (!info) {
            new Notice(`Тег #${oldTag} больше не найден. Обновите список тегов.`);
            return false;
        }
        const scope = this.resolveScope(info, paths, posts);
        if (!scope)
            return false;
        this.pendingChanges.set(oldKey, { oldTag: info.tag, newTag: info.tag, action: "unmark", paths: scope.paths, posts: scope.posts });
        new Notice(`Снятие маркировки #${info.tag}${this.scopeLabel(scope, info)} добавлено в очередь.`);
        this.refreshViews();
        return true;
    }
    removeChange(oldTag, action) {
        const key = tagKey(oldTag, this.settings.caseSensitive);
        if (!action || action === "add")
            this.pendingAdditions.delete(key);
        if (!action || action !== "add") {
            const existing = this.pendingChanges.get(key);
            if (!action || !existing || existing.action === action)
                this.pendingChanges.delete(key);
        }
        this.refreshViews();
    }
    clearChanges() {
        this.pendingChanges.clear();
        this.pendingAdditions.clear();
        this.refreshViews();
    }
    existingMergeTargets(changes = this.getPendingChanges()) {
        const targetKeys = new Set();
        const results = [];
        for (const change of changes) {
            if (change.action === "delete" || change.newTag === null)
                continue;
            const key = tagKey(change.newTag, this.settings.caseSensitive);
            if (key === tagKey(change.oldTag, this.settings.caseSensitive))
                continue;
            const existing = this.tagIndex.get(key);
            if (existing && !results.includes(change.newTag))
                results.push(change.newTag);
            if (targetKeys.has(key) && !results.includes(change.newTag))
                results.push(change.newTag);
            targetKeys.add(key);
        }
        return results;
    }
}

module.exports = { QueueMixin };
