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
        return [...this.pendingChanges.values()];
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
    removeChange(oldTag) {
        this.pendingChanges.delete((0, tag_utils_1.tagKey)(oldTag, this.settings.caseSensitive));
        this.refreshViews();
    }
    clearChanges() {
        this.pendingChanges.clear();
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
        if (report.errors.length === 0)
            this.pendingChanges.clear();
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
