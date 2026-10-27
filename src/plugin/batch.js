"use strict";
/** Пакетная запись файлов и отмена. */
const { Notice, TFile } = require("obsidian");
const { BatchReportModal } = require("../modals/batch-report-modal.js");
const { addTagsToMarkdownDocument } = require("../tags/add-tags.js");
const { moveTagsToText, moveTagsToYaml } = require("../tags/move.js");
const { listPosts, transformPostsOrNote } = require("../tags/posts.js");
const { replaceTagsInMarkdown } = require("../tags/refactor.js");
const { pluralRu } = require("../utils.js");
const { normalizeTag } = require("../tags/tag-name.js");

/** Методы подмешиваются в TagRefactorAuditorPlugin. */
class BatchMixin {
    /**
     * Transform for the audit queue: (file, content) -> new content. Changes are
     * filtered by their note selection; changes limited to chosen records of this
     * note are applied to those records only (grouped by identical selection).
     */
    buildQueueTransform(changes) {
        const caseSensitive = this.settings.caseSensitive;
        return (file, content) => {
            const applicable = this.changesForFile(changes, file);
            const groups = new Map();
            for (const change of applicable) {
                const selection = change.posts?.[file.path] ?? null;
                const key = selection ? JSON.stringify(selection) : "";
                if (!groups.has(key))
                    groups.set(key, { selection, changes: [] });
                groups.get(key).changes.push(change);
            }
            let text = content;
            // Whole-note changes first, so their YAML edits see the original record layout.
            for (const key of [...groups.keys()].sort()) {
                const group = groups.get(key);
                const apply = (value) => replaceTagsInMarkdown(value, group.changes, caseSensitive).text;
                text = transformPostsOrNote(text, group.selection, apply, apply);
            }
            return text;
        };
    }
    /** Transform for the "Заметки по датам" page; `payload.posts` maps paths to chosen records. */
    buildBulkTransform(payload) {
        const caseSensitive = this.settings.caseSensitive;
        const postsFor = (file) => payload.posts?.[file.path] ?? null;
        const checkPosts = (file, content) => {
            const selection = postsFor(file);
            if (selection && listPosts(content).count !== selection.count)
                throw new Error("записи в заметке изменились после выбора — выберите их заново");
            return selection;
        };
        switch (payload.kind) {
            case "add":
                return (file, content) => {
                    const cache = this.app.metadataCache.getFileCache(file);
                    const inlineSourceTags = (cache?.tags ?? []).map((tag) => normalizeTag(tag.tag)).filter(Boolean);
                    return transformPostsOrNote(content, postsFor(file),
                        (value) => addTagsToMarkdownDocument(value, payload.tags, caseSensitive, inlineSourceTags, payload.alwaysYaml === true).text,
                        // Inside a chosen record tags always go into its text.
                        (value) => addTagsToMarkdownDocument(value, payload.tags, caseSensitive, [], false).text);
                };
            case "to-yaml":
                return (file, content) => moveTagsToYaml(content, { tags: payload.tags, caseSensitive, posts: checkPosts(file, content)?.indices });
            case "to-text":
                return (file, content) => moveTagsToText(content, { tags: payload.tags, caseSensitive, posts: checkPosts(file, content)?.indices });
            default: {
                const apply = (value) => replaceTagsInMarkdown(value, payload.changes, caseSensitive).text;
                return (file, content) => transformPostsOrNote(content, postsFor(file), apply, apply);
            }
        }
    }
    /** Before/after of one note for the change preview, without writing anything. */
    async previewTransform(file, transform) {
        const before = await this.app.vault.cachedRead(file);
        return { before, after: transform(file, before) };
    }
    /**
     * Rewrite files with `transform`, collecting undo data. Files whose content
     * would not change are not written at all, so their modification time stays
     * intact and sync tools (Syncthing, Obsidian Sync) see no spurious edits.
     */
    async runBatch(files, transform, report) {
        const undoEntries = new Map();
        for (const file of files) {
            try {
                const current = await this.app.vault.read(file);
                if (transform(file, current) === current) {
                    report.unchangedFiles += 1;
                    continue;
                }
                let before = "";
                let after = "";
                await this.app.vault.process(file, (data) => {
                    before = data;
                    after = transform(file, data);
                    return after;
                });
                if (after !== before) {
                    report.updatedFiles += 1;
                    undoEntries.set(file.path, { before, after });
                }
                else {
                    report.unchangedFiles += 1;
                }
            }
            catch (error) {
                report.errors.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        if (undoEntries.size > 0) {
            this.lastUndo = undoEntries;
            this.lastUndoLabel = new Date().toLocaleString();
        }
        return undoEntries;
    }
    /**
     * Apply the queue. With `selectedPaths`, only those notes are written; the
     * queue is then kept so the remaining notes can be processed later.
     */
    async applyQueuedChanges(selectedPaths = null) {
        if (this.isApplying) {
            new Notice("Операция уже выполняется.");
            return null;
        }
        this.isApplying = true;
        try {
            // The confirmation dialog may have been open for a while: use the
            // current index so that notes tagged in the meantime are included.
            await this.scanTags({ force: true, render: false });
            const changes = this.getPendingChanges();
            const allAffected = this.affectedFiles(changes);
            // Notes tagged after the dialog opened were not offered for selection
            // and are therefore skipped as well.
            const affected = selectedPaths ? allAffected.filter((file) => selectedPaths.has(file.path)) : allAffected;
            const partial = affected.length < allAffected.length;
            const report = {
                requestedChanges: changes.length,
                updatedFiles: 0,
                unchangedFiles: 0,
                errors: [],
                mergedTargets: this.existingMergeTargets(changes),
            };
            await this.runBatch(affected, this.buildQueueTransform(changes), report);
            if (report.errors.length === 0 && !partial) {
                this.pendingChanges.clear();
                this.pendingAdditions.clear();
            }
            await this.scanTags({ force: true });
            if (partial) {
                const skipped = allAffected.length - affected.length;
                report.notes = [`Не выбрано ${skipped} ${pluralRu(skipped, "заметка", "заметки", "заметок")} — очередь сохранена, её можно применить к ним позже или очистить.`];
            }
            new BatchReportModal(this.app, this, report).open();
            return report;
        }
        finally {
            this.isApplying = false;
        }
    }
    async applyBulkTagOperation(files, payload) {
        if (this.isApplying) {
            new Notice("Операция уже выполняется.");
            return null;
        }
        this.isApplying = true;
        try {
            const report = {
                requestedChanges: payload.changes ? payload.changes.length : Math.max(1, payload.tags?.length ?? 0),
                updatedFiles: 0,
                unchangedFiles: 0,
                errors: [],
                mergedTargets: [],
            };
            const transform = this.buildBulkTransform(payload);
            await this.runBatch(files, transform, report);
            await this.scanTags({ force: true });
            new BatchReportModal(this.app, this, report).open();
            return report;
        }
        finally {
            this.isApplying = false;
        }
    }
    async undoLastBatch() {
        if (this.lastUndo.size === 0) {
            new Notice("Нет операции, которую можно отменить.");
            return;
        }
        if (this.isApplying) {
            new Notice("Дождитесь завершения текущей операции.");
            return;
        }
        let restored = 0;
        let skipped = 0;
        const errors = [];
        for (const [path, entry] of this.lastUndo) {
            const abstractFile = this.app.vault.getAbstractFileByPath(path);
            if (!(abstractFile instanceof TFile)) {
                skipped += 1;
                continue;
            }
            let didRestore = false;
            try {
                await this.app.vault.process(abstractFile, (currentContent) => {
                    if (currentContent !== entry.after)
                        return currentContent;
                    didRestore = true;
                    return entry.before;
                });
                if (didRestore)
                    restored += 1;
                else
                    skipped += 1;
            }
            catch (error) {
                errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        this.lastUndo.clear();
        await this.scanTags({ force: true });
        const summary = `Отменено: ${restored}. Пропущено (файл изменился после операции или удалён): ${skipped}. Ошибок: ${errors.length}.`;
        new Notice(summary, 8000);
        new BatchReportModal(this.app, this, {
            requestedChanges: 0,
            updatedFiles: restored,
            unchangedFiles: skipped,
            errors,
            mergedTargets: [],
        }, true).open();
    }
}

module.exports = { BatchMixin };
