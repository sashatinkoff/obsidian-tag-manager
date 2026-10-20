import * as obsidian_1 from "obsidian";
import * as scanner_1 from "./scanner.js";
import * as tag_utils_1 from "./tag-utils.js";
import * as constants_1 from "./constants.js";
import * as view_1 from "./view.js";
import * as modals_1 from "./modals.js";
import * as settings_1 from "./settings.js";
import * as utils_1 from "./utils.js";
class TagRefactorAuditorPlugin extends obsidian_1.Plugin {
    constructor() {
        super(...arguments);
        this.settings = { ...constants_1.DEFAULT_SETTINGS };
        this.tagIndex = new Map();
        this.pendingChanges = new Map();
        this.pendingAdditions = new Map();
        this.lastUndo = new Map();
        this.lastUndoLabel = "";
        this.isScanning = false;
        this.lastScanTime = 0;
        this.debounceTimer = null;
    }
    async onload() {
        await this.loadSettings();
        this.registerView(constants_1.VIEW_TYPE, (leaf) => new view_1.TagAuditorView(leaf, this));
        this.addRibbonIcon("tags", "Tag Refactor & Auditor", () => void this.activateView());
        this.addCommand({
            id: "open-tag-refactor-auditor",
            name: "Open Tag Refactor & Auditor",
            callback: () => void this.activateView(),
        });
        this.addCommand({
            id: "rescan-tags",
            name: "Rescan tags",
            callback: () => void this.scanTags(),
        });
        this.addCommand({
            id: "undo-last-refactor",
            name: "Undo last tag refactor",
            checkCallback: (checking) => {
                if (checking)
                    return this.lastUndo.size > 0;
                void this.undoLastBatch();
                return true;
            },
        });
        this.addSettingTab(new settings_1.TagAuditorSettingTab(this.app, this));
        this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleScan()));
        this.registerEvent(this.app.vault.on("create", () => this.scheduleScan()));
        this.registerEvent(this.app.vault.on("modify", () => this.scheduleScan()));
        this.registerEvent(this.app.vault.on("delete", () => this.scheduleScan()));
        this.registerEvent(this.app.vault.on("rename", () => this.scheduleScan()));
        this.app.workspace.onLayoutReady(() => void this.scanTags());
    }
    onunload() {
        if (this.debounceTimer !== null)
            window.clearTimeout(this.debounceTimer);
        this.app.workspace.getLeavesOfType(constants_1.VIEW_TYPE).forEach((leaf) => leaf.detach());
    }
    async loadSettings() {
        const loaded = (await this.loadData());
        this.settings = {
            ...constants_1.DEFAULT_SETTINGS,
            ...(loaded ?? {}),
            previewChars: (0, utils_1.clampNumber)(loaded?.previewChars, 80, 1200, constants_1.DEFAULT_SETTINGS.previewChars),
            caseSensitive: Boolean(loaded?.caseSensitive ?? constants_1.DEFAULT_SETTINGS.caseSensitive),
            ignoredFolders: Array.isArray(loaded?.ignoredFolders)
                ? loaded.ignoredFolders.filter((path) => typeof path === "string")
                : [...constants_1.DEFAULT_SETTINGS.ignoredFolders],
            createdDateProperty: typeof loaded?.createdDateProperty === "string"
                ? loaded.createdDateProperty.trim()
                : constants_1.DEFAULT_SETTINGS.createdDateProperty,
            minTagMentions: (0, utils_1.clampNumber)(loaded?.minTagMentions, 0, 1000000, constants_1.DEFAULT_SETTINGS.minTagMentions),
        };
    }
    async saveSettings() {
        await this.saveData(this.settings);
        await this.scanTags();
    }
    async activateView() {
        const workspace = this.app.workspace;
        const leaves = workspace.getLeavesOfType(constants_1.VIEW_TYPE);
        const rootLeaves = new Set();
        workspace.iterateRootLeaves((rootLeaf) => rootLeaves.add(rootLeaf));

        // Reuse the view if it is already in the main workspace area. If an older
        // version left it in a sidebar, detach that instance and recreate it as a
        // normal center-area tab.
        let leaf = leaves.find((candidate) => rootLeaves.has(candidate));
        for (const existingLeaf of leaves) {
            if (existingLeaf !== leaf)
                existingLeaf.detach();
        }

        if (!leaf) {
            leaf = workspace.getLeaf("tab");
            await leaf.setViewState({ type: constants_1.VIEW_TYPE, active: true });
        }
        await workspace.revealLeaf(leaf);
    }
    async scanTags() {
        if (this.isScanning)
            return;
        this.isScanning = true;
        try {
            this.tagIndex = (0, scanner_1.scanTagIndex)(this.app, this.settings);
            this.lastScanTime = Date.now();
        }
        finally {
            this.isScanning = false;
            this.refreshViews();
        }
    }
    scheduleScan() {
        if (this.debounceTimer !== null)
            window.clearTimeout(this.debounceTimer);
        this.debounceTimer = window.setTimeout(() => {
            this.debounceTimer = null;
            void this.scanTags();
        }, 300);
    }
    refreshViews() {
        for (const leaf of this.app.workspace.getLeavesOfType(constants_1.VIEW_TYPE)) {
            if (leaf.view instanceof view_1.TagAuditorView)
                leaf.view.render();
        }
    }
    getTagInfo(tag) {
        return this.tagIndex.get((0, tag_utils_1.tagKey)(tag, this.settings.caseSensitive));
    }
    getPendingChanges() {
        return [...this.pendingChanges.values(), ...this.pendingAdditions.values()];
    }
    affectedFiles(changes = this.getPendingChanges()) {
        return (0, scanner_1.filesAffectedByTags)(this.tagIndex, changes.map((change) => change.oldTag), this.settings.caseSensitive);
    }
    addOrUpdateChange(oldTagValue, newTagValue) {
        const oldTag = (0, tag_utils_1.normalizeTag)(oldTagValue);
        const newTag = (0, tag_utils_1.normalizeTag)((0, tag_utils_1.cleanTagInput)(newTagValue));
        if (!oldTag || !newTag) {
            new obsidian_1.Notice("Укажите старый и новый теги.");
            return false;
        }
        if (!(0, tag_utils_1.isValidTag)(newTag)) {
            new obsidian_1.Notice("Имя тега может содержать буквы, цифры, `_`, `-` и `/` для вложенности. Пробелы не поддерживаются.");
            return false;
        }
        const oldKey = (0, tag_utils_1.tagKey)(oldTag, this.settings.caseSensitive);
        if (oldKey === (0, tag_utils_1.tagKey)(newTag, this.settings.caseSensitive)) {
            new obsidian_1.Notice("Старое и новое имена тегов совпадают.");
            return false;
        }
        if (!this.tagIndex.has(oldKey)) {
            new obsidian_1.Notice(`Тег #${oldTag} больше не найден. Обновите список тегов.`);
            return false;
        }
        this.pendingChanges.set(oldKey, { oldTag: this.tagIndex.get(oldKey)?.tag ?? oldTag, newTag, action: "rename" });
        this.refreshViews();
        return true;
    }
    addMultipleTagsChange(sourceTagValue, rawTagsValue) {
        const sourceTag = (0, tag_utils_1.normalizeTag)(sourceTagValue);
        const rawTags = typeof rawTagsValue === "string" ? rawTagsValue : "";
        const requestedTags = rawTags.split(/[\s,;]+/).map((value) => (0, tag_utils_1.cleanTagInput)(value)).filter(Boolean);
        if (!sourceTag || requestedTags.length === 0) {
            new obsidian_1.Notice("Укажите один или несколько новых тегов.");
            return false;
        }
        const oldKey = (0, tag_utils_1.tagKey)(sourceTag, this.settings.caseSensitive);
        const info = this.tagIndex.get(oldKey);
        if (!info) {
            new obsidian_1.Notice(`Тег #${sourceTag} больше не найден. Обновите список тегов.`);
            return false;
        }
        const existingPending = this.pendingAdditions.get(oldKey)?.addTags ?? [];
        const allTags = [...existingPending];
        const seen = new Set(allTags.map((tag) => (0, tag_utils_1.tagKey)(tag, this.settings.caseSensitive)));
        for (const tagValue of requestedTags) {
            const tag = (0, tag_utils_1.normalizeTag)(tagValue);
            if (!tag || !(0, tag_utils_1.isValidTag)(tag)) {
                new obsidian_1.Notice(`Некорректное имя тега: ${tagValue}. Используйте буквы, цифры, \`_\`, \`-\` и \`/\` для вложенности.`);
                return false;
            }
            const key = (0, tag_utils_1.tagKey)(tag, this.settings.caseSensitive);
            if (key === oldKey) {
                new obsidian_1.Notice(`Тег #${tag} уже выбран как исходный; его не нужно добавлять повторно.`);
                continue;
            }
            if (seen.has(key))
                continue;
            seen.add(key);
            allTags.push(tag);
        }
        if (allTags.length === existingPending.length) {
            new obsidian_1.Notice("Все указанные теги уже есть в очереди или совпадают с исходным тегом.");
            return false;
        }
        this.pendingAdditions.set(oldKey, {
            oldTag: info.tag,
            newTag: null,
            action: "add",
            addTags: allTags,
        });
        new obsidian_1.Notice(`Добавление тегов к заметкам с #${info.tag} добавлено в очередь.`);
        this.refreshViews();
        return true;
    }
    addDeleteTagChange(oldTagValue) {
        const oldTag = (0, tag_utils_1.normalizeTag)(oldTagValue);
        if (!oldTag) {
            new obsidian_1.Notice("Не удалось определить тег для удаления.");
            return false;
        }
        const oldKey = (0, tag_utils_1.tagKey)(oldTag, this.settings.caseSensitive);
        const info = this.tagIndex.get(oldKey);
        if (!info) {
            new obsidian_1.Notice(`Тег #${oldTag} больше не найден. Обновите список тегов.`);
            return false;
        }
        this.pendingChanges.set(oldKey, { oldTag: info.tag, newTag: null, action: "delete" });
        new obsidian_1.Notice(`Удаление #${info.tag} добавлено в очередь.`);
        this.refreshViews();
        return true;
    }
    addUnmarkTagChange(oldTagValue) {
        const oldTag = (0, tag_utils_1.normalizeTag)(oldTagValue);
        if (!oldTag) {
            new obsidian_1.Notice("Не удалось определить тег для снятия маркировки.");
            return false;
        }
        const oldKey = (0, tag_utils_1.tagKey)(oldTag, this.settings.caseSensitive);
        const info = this.tagIndex.get(oldKey);
        if (!info) {
            new obsidian_1.Notice(`Тег #${oldTag} больше не найден. Обновите список тегов.`);
            return false;
        }
        this.pendingChanges.set(oldKey, { oldTag: info.tag, newTag: info.tag, action: "unmark" });
        new obsidian_1.Notice(`Снятие маркировки #${info.tag} добавлено в очередь.`);
        this.refreshViews();
        return true;
    }
    removeChange(oldTag, action) {
        const key = (0, tag_utils_1.tagKey)(oldTag, this.settings.caseSensitive);
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
            const key = (0, tag_utils_1.tagKey)(change.newTag, this.settings.caseSensitive);
            if (key === (0, tag_utils_1.tagKey)(change.oldTag, this.settings.caseSensitive))
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
    async applyQueuedChanges() {
        const changes = this.getPendingChanges();
        const affected = this.affectedFiles(changes);
        const report = {
            requestedChanges: changes.length,
            updatedFiles: 0,
            unchangedFiles: 0,
            errors: [],
            mergedTargets: this.existingMergeTargets(changes),
        };
        const undoEntries = new Map();
        for (const file of affected) {
            let before = "";
            let after = "";
            try {
                await this.app.vault.process(file, (currentContent) => {
                    before = currentContent;
                    const result = (0, tag_utils_1.replaceTagsInMarkdown)(currentContent, changes, this.settings.caseSensitive);
                    after = result.text;
                    return result.text;
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
                const message = error instanceof Error ? error.message : String(error);
                report.errors.push(`${file.path}: ${message}`);
            }
        }
        if (undoEntries.size > 0) {
            this.lastUndo = undoEntries;
            this.lastUndoLabel = new Date().toLocaleString();
        }
        if (report.errors.length === 0) {
            this.pendingChanges.clear();
            this.pendingAdditions.clear();
        }
        await this.scanTags();
        new modals_1.BatchReportModal(this.app, this, report).open();
        return report;
    }
    async applyBulkTagOperation(files, payload) {
        const report = {
            requestedChanges: payload.kind === "add" ? payload.tags.length : payload.changes.length,
            updatedFiles: 0,
            unchangedFiles: 0,
            errors: [],
            mergedTargets: [],
        };
        const undoEntries = new Map();
        for (const file of files) {
            let before = "";
            let after = "";
            try {
                await this.app.vault.process(file, (currentContent) => {
                    before = currentContent;
                    let result;
                    if (payload.kind === "add") {
                        const cache = this.app.metadataCache.getFileCache(file);
                        const inlineSourceTags = (cache?.tags ?? [])
                            .map((tag) => (0, tag_utils_1.normalizeTag)(tag.tag))
                            .filter((tag) => Boolean(tag));
                        result = (0, tag_utils_1.addTagsToMarkdownDocument)(currentContent, payload.tags, this.settings.caseSensitive, inlineSourceTags);
                    }
                    else {
                        result = (0, tag_utils_1.replaceTagsInMarkdown)(currentContent, payload.changes, this.settings.caseSensitive);
                    }
                    after = result.text;
                    return result.text;
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
        await this.scanTags();
        new modals_1.BatchReportModal(this.app, this, report).open();
        return report;
    }
    async undoLastBatch() {
        if (this.lastUndo.size === 0) {
            new obsidian_1.Notice("Нет операции, которую можно отменить.");
            return;
        }
        let restored = 0;
        let skipped = 0;
        const errors = [];
        for (const [path, entry] of this.lastUndo) {
            const abstractFile = this.app.vault.getAbstractFileByPath(path);
            if (!(abstractFile instanceof obsidian_1.TFile)) {
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
        await this.scanTags();
        const summary = `Отменено: ${restored}. Пропущено (файл изменился после операции или удалён): ${skipped}. Ошибок: ${errors.length}.`;
        new obsidian_1.Notice(summary, 8000);
        new modals_1.BatchReportModal(this.app, this, {
            requestedChanges: 0,
            updatedFiles: restored,
            unchangedFiles: skipped,
            errors,
            mergedTargets: [],
        }, true).open();
    }
}
export default TagRefactorAuditorPlugin;
