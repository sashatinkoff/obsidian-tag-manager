import * as obsidian_1 from "obsidian";
import * as constants_1 from "./constants.js";
import * as tag_utils_1 from "./tag-utils.js";
import * as utils_1 from "./utils.js";
import * as modals_1 from "./modals.js";
class TagAuditorView extends obsidian_1.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.selectedTag = null;
        this.query = "";
        this.showAllPreviews = false;
        this.sortMode = "name";
        this.plugin = plugin;
    }
    getViewType() {
        return constants_1.VIEW_TYPE;
    }
    getDisplayText() {
        return "Tag Refactor & Auditor";
    }
    getIcon() {
        return "tags";
    }
    async onOpen() {
        this.render();
    }
    async onClose() {
        // No persistent listeners are attached by this view.
    }
    render() {
        const root = this.contentEl;
        root.empty();
        root.addClass("tra-view");
        const shell = root.createDiv({ cls: "tra-shell" });

        const header = shell.createDiv({ cls: "tra-header" });
        const titleGroup = header.createDiv({ cls: "tra-title-group" });
        const iconWrap = titleGroup.createDiv({ cls: "tra-title-icon" });
        (0, obsidian_1.setIcon)(iconWrap, "tags");
        const heading = titleGroup.createDiv({ cls: "tra-heading" });
        heading.createEl("h2", { text: "Tag Refactor" });
        heading.createEl("p", { text: "Аудит и переименование тегов" });
        const scanButton = header.createEl("button", { cls: "tra-icon-button", attr: { "aria-label": "Сканировать теги", title: "Сканировать теги" } });
        (0, obsidian_1.setIcon)(scanButton, "refresh-cw");
        scanButton.addEventListener("click", () => {
            void this.plugin.scanTags().then(() => new obsidian_1.Notice("Сканирование тегов завершено."));
        });

        const overview = shell.createDiv({ cls: "tra-overview" });
        this.createStat(overview, "Теги", String(this.plugin.tagIndex.size), "hash");
        this.createStat(overview, "Заметки", String(this.plugin.app.vault.getMarkdownFiles().length), "files");
        this.createStat(overview, "В очереди", String(this.plugin.pendingChanges.size), "git-pull-request");

        const workspace = shell.createDiv({ cls: "tra-bento-grid" });
        const tagBrowser = workspace.createDiv({ cls: "tra-tag-browser-card" });
        const searchWrap = tagBrowser.createDiv({ cls: "tra-search-wrap" });
        const searchIcon = searchWrap.createDiv({ cls: "tra-search-icon" });
        (0, obsidian_1.setIcon)(searchIcon, "search");
        const search = searchWrap.createEl("input", {
            cls: "tra-search",
            attr: { type: "search", placeholder: "Найти тег…", "aria-label": "Поиск тегов" },
        });
        search.value = this.query;

        const listHeader = tagBrowser.createDiv({ cls: "tra-section-heading" });
        listHeader.createEl("span", { text: "Все теги" });
        const sectionTools = listHeader.createDiv({ cls: "tra-section-tools" });
        sectionTools.createSpan({ cls: "tra-muted", text: `${this.plugin.tagIndex.size}` });
        const sortSelect = sectionTools.createEl("select", {
            cls: "tra-sort-select",
            attr: {
                "aria-label": "Сортировка тегов",
                title: "Последнее упоминание определяется по дате изменения самой свежей заметки с тегом",
            },
        });
        const sortOptions = [
            ["name", "По названию"],
            ["recent", "По последнему упоминанию"],
            ["count", "По количеству"],
        ];
        for (const [value, label] of sortOptions) {
            sortSelect.createEl("option", { text: label, attr: { value } });
        }
        sortSelect.value = this.sortMode;

        const list = tagBrowser.createDiv({ cls: "tra-tag-list" });
        const renderList = () => this.renderTagRows(list, search.value);
        search.addEventListener("input", () => {
            this.query = search.value;
            renderList();
        });
        sortSelect.addEventListener("change", () => {
            this.sortMode = sortSelect.value;
            renderList();
        });
        renderList();

        // Bento layout: tag browser occupies the left column; preview and queue
        // are separate cards in the right column.
        this.renderSelectedTag(workspace);
        this.renderPendingChanges(workspace);

        const footer = shell.createDiv({ cls: "tra-footer" });
        footer.createSpan({ text: this.plugin.lastScanTime ? `Синхронизировано · ${(0, utils_1.relativeTime)(this.plugin.lastScanTime)}` : "Ожидание индекса" });
        const settingsButton = footer.createEl("button", { cls: "tra-text-button", text: "Настройки" });
        settingsButton.addEventListener("click", () => {
            // The settings tab is opened using Obsidian's built-in settings pane.
            // @ts-expect-error Obsidian exposes this method at runtime; it is not in all typings.
            this.plugin.app.setting?.open();
            // @ts-expect-error plugin id is supported by Obsidian's settings pane.
            this.plugin.app.setting?.openTabById?.(this.plugin.manifest.id);
        });
    }
    createStat(parent, label, value, iconName) {
        const stat = parent.createDiv({ cls: "tra-stat" });
        const icon = stat.createDiv({ cls: "tra-stat-icon" });
        (0, obsidian_1.setIcon)(icon, iconName);
        stat.createDiv({ cls: "tra-stat-label", text: label });
        stat.createDiv({ cls: "tra-stat-value", text: value });
    }
    renderTagRows(parent, query) {
        parent.empty();
        const normalizedQuery = query.trim().replace(/^#/, "").toLocaleLowerCase();
        const entries = [...this.plugin.tagIndex.values()].filter((info) => info.tag.toLocaleLowerCase().includes(normalizedQuery));
        const compareByName = (a, b) => a.tag.localeCompare(b.tag, undefined, {
            sensitivity: this.plugin.settings.caseSensitive ? "variant" : "base",
            numeric: true,
        });
        // Obsidian does not store a separate timestamp for each tag token, so
        // “last mention” uses the mtime of the most recently modified note that contains it.
        const latestTimes = new Map(entries.map((info) => [
            info.key,
            info.files.reduce((latest, file) => Math.max(latest, file.stat?.mtime ?? 0), 0),
        ]));
        entries.sort((a, b) => {
            if (this.sortMode === "count")
                return b.files.length - a.files.length || compareByName(a, b);
            if (this.sortMode === "recent")
                return (latestTimes.get(b.key) ?? 0) - (latestTimes.get(a.key) ?? 0) || compareByName(a, b);
            return compareByName(a, b);
        });
        if (entries.length === 0) {
            const empty = parent.createDiv({ cls: "tra-empty" });
            const icon = empty.createDiv({ cls: "tra-empty-icon" });
            (0, obsidian_1.setIcon)(icon, normalizedQuery ? "search-x" : "tags");
            empty.createEl("p", { text: normalizedQuery ? "Ничего не найдено" : "Теги не найдены" });
            empty.createEl("span", { text: normalizedQuery ? "Попробуйте другой запрос." : "После сканирования здесь появятся теги из заметок." });
            return;
        }
        for (const info of entries) {
            const isSelected = this.selectedTag !== null && (0, tag_utils_1.tagKey)(this.selectedTag, this.plugin.settings.caseSensitive) === info.key;
            const isPending = this.plugin.pendingChanges.has(info.key);
            const row = parent.createEl("button", {
                cls: `tra-tag-row${isSelected ? " is-selected" : ""}${isPending ? " is-pending" : ""}`,
                attr: { type: "button" },
            });
            const hash = row.createSpan({ cls: "tra-tag-hash", text: "#" });
            hash.setAttr("aria-hidden", "true");
            row.createSpan({ cls: "tra-tag-name", text: info.tag });
            if (isPending) {
                const pendingMark = row.createSpan({ cls: "tra-pending-dot" });
                pendingMark.setAttr("aria-label", "На изменение");
            }
            row.createSpan({ cls: "tra-tag-count", text: String(info.files.length) });
            row.addEventListener("click", () => {
                this.selectedTag = info.tag;
                this.showAllPreviews = false;
                this.render();
            });
        }
    }
    renderSelectedTag(root) {
        if (!this.selectedTag) {
            const tip = root.createDiv({ cls: "tra-select-prompt" });
            const icon = tip.createDiv({ cls: "tra-select-icon" });
            (0, obsidian_1.setIcon)(icon, "mouse-pointer-click");
            tip.createEl("strong", { text: "Выберите тег" });
            tip.createEl("p", { text: "Посмотрите, где он используется, и добавьте переименование в очередь." });
            return;
        }
        const info = this.plugin.getTagInfo(this.selectedTag);
        if (!info) {
            this.selectedTag = null;
            return;
        }
        const card = root.createDiv({ cls: "tra-selected-card" });
        const selectedHeader = card.createDiv({ cls: "tra-selected-header" });
        const selectedTitle = selectedHeader.createDiv({ cls: "tra-selected-title" });
        selectedTitle.createEl("span", { cls: "tra-tag-hash", text: "#" });
        selectedTitle.createEl("h3", { text: info.tag });
        selectedHeader.createEl("span", { cls: "tra-count-pill", text: `${info.files.length} ${(0, utils_1.pluralRu)(info.files.length, "заметка", "заметки", "заметок")}` });
        const form = card.createDiv({ cls: "tra-rename-form" });
        const label = form.createEl("label", { text: "Новое имя тега", cls: "tra-field-label" });
        const fieldRow = form.createDiv({ cls: "tra-field-row" });
        const hashPrefix = fieldRow.createSpan({ cls: "tra-input-prefix", text: "#" });
        hashPrefix.setAttr("aria-hidden", "true");
        const input = fieldRow.createEl("input", {
            cls: "tra-rename-input",
            attr: { type: "text", placeholder: "новый-тег", autocomplete: "off", spellcheck: "false" },
        });
        label.setAttr("for", input.id = `tra-rename-${Math.random().toString(36).slice(2, 9)}`);
        const addButton = fieldRow.createEl("button", { cls: "tra-primary-button tra-add-button", text: "В очередь" });
        addButton.type = "button";
        const warning = form.createDiv({ cls: "tra-inline-warning" });
        const updateWarning = () => {
            const value = (0, tag_utils_1.cleanTagInput)(input.value);
            warning.empty();
            if (!value)
                return;
            if (!(0, tag_utils_1.isValidTag)(value)) {
                warning.setText("Используйте буквы, цифры, `_`, `-` и `/`.");
                warning.addClass("is-error");
                return;
            }
            warning.removeClass("is-error");
            const target = this.plugin.getTagInfo(value);
            if (target && (0, tag_utils_1.tagKey)(value, this.plugin.settings.caseSensitive) !== info.key) {
                warning.setText(`#${value} уже существует. Теги будут объединены.`);
                warning.addClass("is-warning");
            }
        };
        input.addEventListener("input", updateWarning);
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                addButton.click();
            }
        });
        addButton.addEventListener("click", () => {
            const target = (0, tag_utils_1.cleanTagInput)(input.value);
            if (this.plugin.addOrUpdateChange(info.tag, target)) {
                this.selectedTag = info.tag;
                this.render();
            }
        });
        const previewHeader = card.createDiv({ cls: "tra-preview-header" });
        const previewTitle = previewHeader.createDiv({ cls: "tra-preview-title" });
        (0, obsidian_1.setIcon)(previewTitle.createSpan({ cls: "tra-preview-icon" }), "files");
        previewTitle.createEl("span", { text: "В заметках" });
        previewHeader.createSpan({ cls: "tra-muted", text: "Предпросмотр" });
        const previews = card.createDiv({ cls: "tra-preview-list" });
        void this.renderPreviews(previews, info);
    }
    async renderPreviews(parent, info) {
        const files = info.files;
        const limit = this.showAllPreviews ? files.length : Math.min(files.length, 8);
        for (const file of files.slice(0, limit)) {
            const item = parent.createDiv({
                cls: "tra-file-card is-clickable",
                attr: { role: "button", tabindex: "0", "aria-label": `Открыть заметку ${file.basename} в новой вкладке` },
            });
            const openInNewTab = () => {
                void this.plugin.app.workspace.getLeaf("tab").openFile(file);
            };
            item.addEventListener("click", openInNewTab);
            item.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openInNewTab();
                }
            });
            const titleRow = item.createDiv({ cls: "tra-file-title-row" });
            const docIcon = titleRow.createDiv({ cls: "tra-file-icon" });
            (0, obsidian_1.setIcon)(docIcon, "file-text");
            const link = titleRow.createSpan({ cls: "tra-file-link", text: file.basename });
            link.setAttr("title", file.path);
            const path = item.createDiv({ cls: "tra-file-path", text: file.path });
            try {
                const raw = await this.plugin.app.vault.cachedRead(file);
                const withoutFrontmatter = raw.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "");
                const tagIndex = (0, tag_utils_1.findInlineTagIndex)(withoutFrontmatter, info.tag, this.plugin.settings.caseSensitive);
                const plainIndex = tagIndex >= 0 ? tagIndex : (0, utils_1.findTextIndex)(withoutFrontmatter, info.tag, this.plugin.settings.caseSensitive);
                const maxChars = this.plugin.settings.previewChars;
                const start = plainIndex >= 0 ? Math.max(0, plainIndex - Math.floor(maxChars * 0.28)) : 0;
                const excerpt = withoutFrontmatter.slice(start, start + maxChars);
                const excerptEl = item.createDiv({ cls: "tra-excerpt" });
                if (start > 0)
                    excerptEl.createSpan({ text: "…" });
                (0, utils_1.appendExcerptWithHighlight)(excerptEl, excerpt, info.tag, this.plugin.settings.caseSensitive);
                if (start + maxChars < withoutFrontmatter.length)
                    excerptEl.createSpan({ text: "…" });
            }
            catch {
                item.createDiv({ cls: "tra-excerpt tra-muted", text: "Не удалось прочитать заметку." });
            }
            // Keep the path available to screen readers even when the title is short.
            path.setAttr("aria-label", file.path);
        }
        if (files.length > limit) {
            const more = parent.createEl("button", {
                cls: "tra-show-more",
                text: `Показать ещё ${files.length - limit}`,
                attr: { type: "button" },
            });
            more.addEventListener("click", () => {
                this.showAllPreviews = true;
                this.render();
            });
        }
        else if (this.showAllPreviews && files.length > 8) {
            const less = parent.createEl("button", { cls: "tra-show-more", text: "Свернуть список", attr: { type: "button" } });
            less.addEventListener("click", () => {
                this.showAllPreviews = false;
                this.render();
            });
        }
    }
    renderPendingChanges(root) {
        const changes = this.plugin.getPendingChanges();
        const section = root.createDiv({ cls: "tra-queue-card" });
        const header = section.createDiv({ cls: "tra-queue-header" });
        const titleGroup = header.createDiv({ cls: "tra-queue-title-group" });
        const icon = titleGroup.createDiv({ cls: "tra-queue-icon" });
        (0, obsidian_1.setIcon)(icon, "git-pull-request");
        const title = titleGroup.createDiv();
        title.createEl("h3", { text: "На изменение" });
        title.createEl("p", { text: "Проверьте список перед применением" });
        header.createSpan({ cls: "tra-queue-count", text: String(changes.length) });
        if (changes.length === 0) {
            const empty = section.createDiv({ cls: "tra-queue-empty" });
            empty.createEl("span", { text: "Очередь пока пуста" });
            empty.createEl("small", { text: "Выберите тег выше и задайте новое имя." });
            return;
        }
        const list = section.createDiv({ cls: "tra-queue-list" });
        for (const change of changes) {
            const row = list.createDiv({ cls: "tra-queue-row" });
            const mapping = row.createDiv({ cls: "tra-queue-mapping" });
            mapping.createDiv({ cls: "tra-queue-old", text: `#${change.oldTag}` });
            const arrow = mapping.createDiv({ cls: "tra-queue-arrow" });
            (0, obsidian_1.setIcon)(arrow, "arrow-right");
            mapping.createDiv({ cls: "tra-queue-new", text: `#${change.newTag}` });
            const info = this.plugin.getTagInfo(change.oldTag);
            row.createDiv({ cls: "tra-queue-files", text: `${info?.files.length ?? 0} ${(0, utils_1.pluralRu)(info?.files.length ?? 0, "заметка", "заметки", "заметок")}` });
            const remove = row.createEl("button", { cls: "tra-remove-change", attr: { type: "button", title: "Убрать из очереди", "aria-label": `Убрать #${change.oldTag}` } });
            (0, obsidian_1.setIcon)(remove, "x");
            remove.addEventListener("click", () => this.plugin.removeChange(change.oldTag));
        }
        const totalFiles = this.plugin.affectedFiles(changes).length;
        const footer = section.createDiv({ cls: "tra-queue-footer" });
        footer.createSpan({ cls: "tra-queue-total", text: `${totalFiles} ${(0, utils_1.pluralRu)(totalFiles, "файл", "файла", "файлов")} затронуто` });
        const actions = section.createDiv({ cls: "tra-queue-actions" });
        const clear = actions.createEl("button", { cls: "tra-secondary-button", text: "Очистить" });
        clear.type = "button";
        clear.addEventListener("click", () => this.plugin.clearChanges());
        const apply = actions.createEl("button", { cls: "tra-primary-button tra-apply-button" });
        apply.type = "button";
        const applyIcon = apply.createSpan({ cls: "tra-button-icon" });
        (0, obsidian_1.setIcon)(applyIcon, "check-check");
        apply.createSpan({ text: "Применить" });
        apply.addEventListener("click", () => {
            const mergedTargets = this.plugin.existingMergeTargets(changes);
            new modals_1.ApplyConfirmModal(this.plugin.app, changes, totalFiles, mergedTargets, () => this.plugin.applyQueuedChanges()).open();
        });
    }
}

export { TagAuditorView };
