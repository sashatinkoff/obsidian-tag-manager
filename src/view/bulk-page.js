"use strict";
/** Страница «Заметки по датам»: фильтр, выбор карточек и массовые операции. */
const { MarkdownRenderer, Notice, setIcon } = require("obsidian");
const { BULK_PAGE_SIZE } = require("../constants.js");
const { BulkApplyConfirmModal } = require("../modals/bulk-apply-confirm-modal.js");
const { NotePreviewModal } = require("../modals/note-preview-modal.js");
const { makeIgnoredPathMatcher } = require("../scanner.js");
const { stripFrontmatter } = require("../tags/frontmatter.js");
const { cleanTagInput, isValidTag, normalizeTag, tagKey } = require("../tags/tag-name.js");
const { pluralRu, updatePostBadge } = require("../utils.js");

/** Методы подмешиваются в TagAuditorView. */
class BulkPageMixin {
    getBulkFilteredFiles() {
        const isIgnored = makeIgnoredPathMatcher(this.plugin.settings.ignoredFolders ?? []);
        const caseSensitive = this.plugin.settings.caseSensitive;
        const fromTime = this.bulkDateFrom ? Date.parse(`${this.bulkDateFrom}T00:00:00.000Z`) : null;
        const toTime = this.bulkDateTo ? Date.parse(`${this.bulkDateTo}T23:59:59.999Z`) : null;
        const folder = this.bulkFolder.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
        const keysOf = (tags) => tags.map((tag) => tagKey(tag, caseSensitive));
        const include = keysOf(this.bulkIncludeTags);
        const exclude = new Set(keysOf(this.bulkExcludeTags));
        const mode = this.bulkTagMode;
        return this.plugin.app.vault.getMarkdownFiles()
            .filter((file) => !isIgnored(file.path))
            .filter((file) => !folder || file.path === folder || file.path.startsWith(`${folder}/`))
            .filter((file) => {
                if (fromTime === null && toTime === null)
                    return true;
                const created = this.getNoteCreationTimestamp(file);
                if (!created)
                    return false;
                if (fromTime !== null && created < fromTime)
                    return false;
                if (toTime !== null && created > toTime)
                    return false;
                return true;
            })
            .filter((file) => {
                const keys = new Set(keysOf(this.getTagsForFile(file)));
                if (mode === "none" && keys.size > 0)
                    return false;
                if (mode === "all" && !include.every((key) => keys.has(key)))
                    return false;
                if (mode === "some" && !include.some((key) => keys.has(key)))
                    return false;
                for (const key of exclude) {
                    if (keys.has(key))
                        return false;
                }
                return true;
            })
            .filter((file) => !this.bulkTextMatches || this.bulkTextMatches.has(file.path))
            .sort((a, b) => this.compareByCreation(a, b));
    }
    /** Paths of notes whose name or text contains `query` (case-insensitive). */
    async findTextMatches(query) {
        const needle = query.trim().toLocaleLowerCase();
        const isIgnored = makeIgnoredPathMatcher(this.plugin.settings.ignoredFolders ?? []);
        const matches = new Set();
        const files = this.plugin.app.vault.getMarkdownFiles().filter((file) => !isIgnored(file.path));
        // Read in small parallel batches to keep the UI responsive on large vaults.
        for (let i = 0; i < files.length; i += 50) {
            await Promise.all(files.slice(i, i + 50).map(async (file) => {
                if (file.basename.toLocaleLowerCase().includes(needle)) {
                    matches.add(file.path);
                    return;
                }
                try {
                    const text = await this.plugin.app.vault.cachedRead(file);
                    if (text.toLocaleLowerCase().includes(needle))
                        matches.add(file.path);
                }
                catch {
                    // Unreadable files simply do not match.
                }
            }));
        }
        return matches;
    }
    getVaultFolders() {
        const folders = new Set();
        for (const file of this.plugin.app.vault.getMarkdownFiles()) {
            const parts = file.path.split("/");
            for (let i = 1; i < parts.length; i += 1)
                folders.add(parts.slice(0, i).join("/"));
        }
        return [...folders].sort((a, b) => a.localeCompare(b));
    }
    /** Chips + input with tag autocomplete; `values` is edited in place. */
    renderTagChipsInput(parent, labelText, values, field, onChange) {
        const id = `tra-${field}`;
        parent.createEl("label", { text: labelText, attr: { for: id } });
        const box = parent.createDiv({ cls: "tra-chip-input" });
        const chips = box.createDiv({ cls: "tra-chip-list" });
        const input = box.createEl("input", { attr: { id, type: "text", list: "tra-bulk-tag-options", placeholder: "Добавить тег…", autocomplete: "off", spellcheck: "false", "data-tra-field": field } });
        const renderChips = () => {
            chips.empty();
            for (const tag of values) {
                const chip = chips.createSpan({ cls: "tra-chip", text: `#${tag}` });
                const remove = chip.createEl("button", { cls: "tra-chip-remove", attr: { type: "button", "aria-label": `Убрать #${tag}` }, text: "×" });
                remove.addEventListener("click", () => {
                    values.splice(values.indexOf(tag), 1);
                    renderChips();
                    onChange();
                });
            }
        };
        const commit = () => {
            const raw = input.value.split(/[\s,;]+/).map((item) => normalizeTag(cleanTagInput(item))).filter(Boolean);
            if (raw.length === 0)
                return;
            const unknown = [];
            for (const tag of raw) {
                const info = this.plugin.getTagInfo(tag);
                if (!info) {
                    unknown.push(tag);
                    continue;
                }
                if (!values.some((value) => tagKey(value, this.plugin.settings.caseSensitive) === info.key))
                    values.push(info.tag);
            }
            input.value = unknown.join(" ");
            if (unknown.length)
                new Notice(`Нет таких тегов: ${unknown.map((tag) => `#${tag}`).join(", ")}`);
            renderChips();
            onChange();
        };
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                commit();
            }
            else if (event.key === "Backspace" && input.value === "" && values.length > 0) {
                values.pop();
                renderChips();
                onChange();
            }
        });
        // Picking an option from the autocomplete list.
        input.addEventListener("input", (event) => {
            if (event.inputType === "insertReplacementText" || (event.inputType === undefined && this.plugin.getTagInfo(cleanTagInput(input.value))))
                commit();
        });
        input.addEventListener("blur", () => {
            if (input.value.trim())
                commit();
        });
        renderChips();
    }
    /** Notes with a date first (newest or oldest first), undated notes last. */
    compareByCreation(a, b) {
        const timeA = this.getNoteCreationTimestamp(a);
        const timeB = this.getNoteCreationTimestamp(b);
        if (!timeA && timeB)
            return 1;
        if (timeA && !timeB)
            return -1;
        const delta = timeA - timeB;
        return (this.bulkDateSort === "oldest" ? delta : -delta) || a.path.localeCompare(b.path);
    }
    renderBulkManagement(shell) {
        const intro = shell.createDiv({ cls: "tra-bulk-intro" });
        intro.createEl("h3", { text: "Управление заметками по датам" });
        intro.createEl("p", { text: "Отберите заметки по дате, выделите нужные карточки и выполните одну операцию над тегами только в выбранных файлах." });

        const layout = shell.createDiv({ cls: "tra-bulk-layout" });
        const controls = layout.createDiv({ cls: "tra-bulk-controls-card" });
        const controlsHeader = controls.createDiv({ cls: "tra-bulk-card-heading" });
        setIcon(controlsHeader.createSpan({ cls: "tra-bulk-heading-icon" }), "sliders-horizontal");
        controlsHeader.createEl("h3", { text: "Параметры операции" });

        const dateGroup = controls.createDiv({ cls: "tra-bulk-form-group" });
        dateGroup.createEl("span", { cls: "tra-bulk-label", text: "Дата заметки" });
        const dateRow = dateGroup.createDiv({ cls: "tra-bulk-date-row" });
        const fromWrap = dateRow.createDiv({ cls: "tra-bulk-date-field" });
        fromWrap.createEl("label", { text: "От", attr: { for: "tra-bulk-date-from" } });
        const fromInput = fromWrap.createEl("input", { cls: "tra-bulk-input", attr: { id: "tra-bulk-date-from", type: "date", "aria-label": "Дата создания от" } });
        fromInput.value = this.bulkDateFrom;
        const toWrap = dateRow.createDiv({ cls: "tra-bulk-date-field" });
        toWrap.createEl("label", { text: "До", attr: { for: "tra-bulk-date-to" } });
        const toInput = toWrap.createEl("input", { cls: "tra-bulk-input", attr: { id: "tra-bulk-date-to", type: "date", "aria-label": "Дата создания до" } });
        toInput.value = this.bulkDateTo;
        const sourceField = dateGroup.createDiv({ cls: "tra-bulk-date-source" });
        sourceField.createEl("label", { text: "Источник даты", attr: { for: "tra-bulk-date-source" } });
        const sourceSelect = sourceField.createEl("select", { cls: "tra-bulk-input", attr: { id: "tra-bulk-date-source", "aria-label": "Источник даты заметки" } });
        this.fillDateSourceOptions(sourceSelect);
        const dateHint = dateGroup.createDiv({ cls: "tra-bulk-hint tra-bulk-date-stats" });
        this.renderDateStats(dateHint);
        sourceSelect.addEventListener("change", async () => {
            await this.plugin.setDateSource(sourceSelect.value);
            this.renderDateStats(dateHint);
            invalidateBulkFilter();
        });
        const filterGroup = controls.createDiv({ cls: "tra-bulk-form-group tra-bulk-filter-group" });
        filterGroup.createEl("span", { cls: "tra-bulk-label", text: "Фильтры" });
        // Shared autocomplete list of existing tags for all tag inputs.
        const tagOptions = filterGroup.createEl("datalist", { attr: { id: "tra-bulk-tag-options" } });
        for (const info of this.plugin.tagIndex.values())
            tagOptions.createEl("option", { attr: { value: info.tag } });

        const folderField = filterGroup.createDiv({ cls: "tra-bulk-filter-field" });
        folderField.createEl("label", { text: "Папка", attr: { for: "tra-bulk-folder" } });
        const folderInput = folderField.createEl("input", { cls: "tra-bulk-input", attr: { id: "tra-bulk-folder", type: "text", list: "tra-bulk-folder-options", placeholder: "Все папки", autocomplete: "off", spellcheck: "false", "data-tra-field": "bulk-folder" } });
        folderInput.value = this.bulkFolder;
        const folderOptions = folderField.createEl("datalist", { attr: { id: "tra-bulk-folder-options" } });
        for (const folder of this.getVaultFolders())
            folderOptions.createEl("option", { attr: { value: folder } });

        const modeField = filterGroup.createDiv({ cls: "tra-bulk-filter-field" });
        modeField.createEl("label", { text: "Теги", attr: { for: "tra-bulk-tag-mode" } });
        const modeSelect = modeField.createEl("select", { cls: "tra-bulk-input", attr: { id: "tra-bulk-tag-mode" } });
        for (const [value, label] of [["any", "Любые (не фильтровать)"], ["none", "Без тегов"], ["all", "Есть все теги из списка"], ["some", "Есть любой тег из списка"]])
            modeSelect.createEl("option", { text: label, attr: { value } });
        modeSelect.value = this.bulkTagMode;
        const includeField = filterGroup.createDiv({ cls: "tra-bulk-filter-field tra-bulk-include-field" });
        this.renderTagChipsInput(includeField, "Список тегов", this.bulkIncludeTags, "bulk-include", () => invalidateBulkFilter());
        const excludeField = filterGroup.createDiv({ cls: "tra-bulk-filter-field" });
        this.renderTagChipsInput(excludeField, "Исключить заметки с тегами", this.bulkExcludeTags, "bulk-exclude", () => invalidateBulkFilter());
        const syncModeFields = () => {
            includeField.style.display = this.bulkTagMode === "all" || this.bulkTagMode === "some" ? "" : "none";
        };
        syncModeFields();

        const textField = filterGroup.createDiv({ cls: "tra-bulk-filter-field" });
        textField.createEl("label", { text: "Текст в названии или заметке", attr: { for: "tra-bulk-text" } });
        const textInput = textField.createEl("input", { cls: "tra-bulk-input", attr: { id: "tra-bulk-text", type: "search", placeholder: "Например: шлагбаум", spellcheck: "false", "data-tra-field": "bulk-text" } });
        textInput.value = this.bulkTextQuery;

        const applyFilterButton = filterGroup.createEl("button", { cls: "tra-primary-button tra-bulk-filter-apply", attr: { type: "button" } });
        setIcon(applyFilterButton.createSpan({ cls: "tra-button-icon" }), "filter");
        applyFilterButton.createSpan({ text: "Применить фильтр" });
        const invalidateBulkFilter = () => {
            this.bulkFilterApplied = false;
            this.bulkSelectedPaths.clear();
            this.bulkPostSelection.clear();
            this.bulkVisibleFiles = [];
            const root = this.contentEl;
            const list = root.querySelector(".tra-bulk-note-list");
            if (list) {
                list.empty();
                list.createDiv({ cls: "tra-bulk-empty tra-bulk-filter-placeholder", text: "Настройте фильтры и нажмите «Применить фильтр», чтобы загрузить карточки заметок." });
            }
            const countBadge = root.querySelector(".tra-bulk-results-count");
            if (countBadge)
                countBadge.setText("—");
            this.syncBulkSelectionUI();
        };
        applyFilterButton.addEventListener("click", async () => {
            if (this.bulkDateFrom && this.bulkDateTo && this.bulkDateFrom > this.bulkDateTo) {
                new Notice("Дата «От» не может быть позже даты «До».");
                return;
            }
            if ((this.bulkTagMode === "all" || this.bulkTagMode === "some") && this.bulkIncludeTags.length === 0) {
                new Notice("Добавьте в список хотя бы один тег или выберите «Любые».");
                return;
            }
            applyFilterButton.disabled = true;
            try {
                // Text search reads note contents, so it runs once here and is cached.
                this.bulkTextMatches = this.bulkTextQuery.trim() ? await this.findTextMatches(this.bulkTextQuery) : null;
            }
            finally {
                applyFilterButton.disabled = false;
            }
            this.bulkFilterApplied = true;
            this.bulkSelectedPaths.clear();
            this.bulkPostSelection.clear();
            this.bulkVisibleFiles = [];
            this.bulkRenderLimit = BULK_PAGE_SIZE;
            this.render();
        });
        const updateDateRange = () => {
            this.bulkDateFrom = fromInput.value;
            this.bulkDateTo = toInput.value;
            // Preserve native date inputs while the user is entering a date.
            // Filter validation happens only when the apply button is pressed.
            invalidateBulkFilter();
        };
        fromInput.addEventListener("change", updateDateRange);
        toInput.addEventListener("change", updateDateRange);
        folderInput.addEventListener("input", () => {
            this.bulkFolder = folderInput.value;
            invalidateBulkFilter();
        });
        modeSelect.addEventListener("change", () => {
            this.bulkTagMode = modeSelect.value;
            syncModeFields();
            invalidateBulkFilter();
        });
        textInput.addEventListener("input", () => {
            this.bulkTextQuery = textInput.value;
            invalidateBulkFilter();
        });
        textInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter")
                applyFilterButton.click();
        });

        const actionGroup = controls.createDiv({ cls: "tra-bulk-form-group" });
        actionGroup.createEl("label", { cls: "tra-bulk-label", text: "Операция", attr: { for: "tra-bulk-action" } });
        const actionSelect = actionGroup.createEl("select", { cls: "tra-bulk-input", attr: { id: "tra-bulk-action", "aria-label": "Тип массовой операции" } });
        actionSelect.createEl("option", { text: "Добавить теги", attr: { value: "add" } });
        actionSelect.createEl("option", { text: "Переименовать теги", attr: { value: "rename" } });
        actionSelect.createEl("option", { text: "Удалить теги", attr: { value: "delete" } });
        actionSelect.createEl("option", { text: "Перенести теги из текста в свойства (YAML)", attr: { value: "to-yaml" } });
        actionSelect.createEl("option", { text: "Перенести теги из свойств (YAML) в текст", attr: { value: "to-text" } });
        actionSelect.value = this.bulkAction;

        const addFields = actionGroup.createDiv({ cls: "tra-bulk-action-fields" });
        const addLabel = addFields.createEl("label", { cls: "tra-bulk-label", text: "Теги для добавления", attr: { for: "tra-bulk-add-input" } });
        const addInput = addFields.createEl("textarea", { cls: "tra-bulk-textarea", attr: { id: "tra-bulk-add-input", "data-tra-field": "bulk-add", rows: "4", placeholder: "новый-тег1, новый-тег2\nновый-тег3", spellcheck: "false" } });
        addInput.value = this.bulkInputs.add;
        addLabel.setAttr("for", addInput.id);
        addInput.addEventListener("input", () => { this.bulkInputs.add = addInput.value; });
        const alwaysYamlLabel = addFields.createEl("label", { cls: "tra-bulk-always-yaml" });
        const alwaysYamlCheckbox = alwaysYamlLabel.createEl("input", { attr: { type: "checkbox", "aria-label": "Всегда добавлять в атрибуты" } });
        alwaysYamlCheckbox.checked = this.bulkAlwaysAddToAttributes;
        alwaysYamlLabel.createSpan({ text: "Всегда добавлять в атрибуты" });
        alwaysYamlCheckbox.addEventListener("change", () => { this.bulkAlwaysAddToAttributes = alwaysYamlCheckbox.checked; });
        addFields.createDiv({ cls: "tra-bulk-hint", text: "По умолчанию теги добавляются в существующие YAML-атрибуты tag/tags, а при их отсутствии — в текст заметки." });

        const renameFields = actionGroup.createDiv({ cls: "tra-bulk-action-fields" });
        const renameLabel = renameFields.createEl("label", { cls: "tra-bulk-label", text: "Соответствия старый → новый", attr: { for: "tra-bulk-rename-input" } });
        const renameInput = renameFields.createEl("textarea", { cls: "tra-bulk-textarea", attr: { id: "tra-bulk-rename-input", "data-tra-field": "bulk-rename", rows: "4", placeholder: "старый-тег -> новый-тег\nдругой -> новое-имя", spellcheck: "false" } });
        renameInput.value = this.bulkInputs.rename;
        renameInput.addEventListener("input", () => { this.bulkInputs.rename = renameInput.value; });
        renameFields.createDiv({ cls: "tra-bulk-hint", text: "Одна пара на строку. Затрагиваются только выбранные заметки." });

        const deleteFields = actionGroup.createDiv({ cls: "tra-bulk-action-fields" });
        const deleteLabel = deleteFields.createEl("label", { cls: "tra-bulk-label", text: "Теги для удаления", attr: { for: "tra-bulk-delete-input" } });
        const deleteInput = deleteFields.createEl("textarea", { cls: "tra-bulk-textarea", attr: { id: "tra-bulk-delete-input", "data-tra-field": "bulk-delete", rows: "4", placeholder: "тег1, тег2", spellcheck: "false" } });
        deleteInput.value = this.bulkInputs.delete;
        deleteInput.addEventListener("input", () => { this.bulkInputs.delete = deleteInput.value; });
        deleteFields.createDiv({ cls: "tra-bulk-hint", text: "Будут удалены сами упоминания тегов и соответствующие записи YAML." });

        const moveFields = actionGroup.createDiv({ cls: "tra-bulk-action-fields" });
        moveFields.createEl("label", { cls: "tra-bulk-label", text: "Какие теги переносить", attr: { for: "tra-bulk-move-input" } });
        const moveInput = moveFields.createEl("textarea", { cls: "tra-bulk-textarea", attr: { id: "tra-bulk-move-input", "data-tra-field": "bulk-move", rows: "3", placeholder: "Пусто — все теги", spellcheck: "false" } });
        moveInput.value = this.bulkInputs.move ?? "";
        moveInput.addEventListener("input", () => { this.bulkInputs.move = moveInput.value; });
        const moveHint = moveFields.createDiv({ cls: "tra-bulk-hint" });

        const switchActionFields = () => {
            moveFields.style.display = this.bulkAction === "to-yaml" || this.bulkAction === "to-text" ? "block" : "none";
            moveHint.setText(this.bulkAction === "to-yaml"
                ? "Теги из текста удаляются (строки, где были только теги, тоже) и записываются в свойство tags; если его нет, оно создаётся. При выборе отдельных записей переносятся теги только из них."
                : "Теги удаляются из свойств tag/tags и добавляются строкой #тег в конец последней записи (перед завершающим ---). При выборе отдельных записей строка добавляется в каждую выбранную запись.");
            addFields.style.display = this.bulkAction === "add" ? "block" : "none";
            renameFields.style.display = this.bulkAction === "rename" ? "block" : "none";
            deleteFields.style.display = this.bulkAction === "delete" ? "block" : "none";
        };
        actionSelect.addEventListener("change", () => {
            this.bulkAction = actionSelect.value;
            switchActionFields();
        });
        switchActionFields();

        const selectedSummary = controls.createDiv({ cls: "tra-bulk-selected-summary" });
        selectedSummary.createDiv({ cls: "tra-bulk-selected-count", text: "Выбрано 0 заметок" });
        const applyButton = controls.createEl("button", { cls: "tra-primary-button tra-bulk-apply", attr: { type: "button" } });
        setIcon(applyButton.createSpan({ cls: "tra-button-icon" }), "check-check");
        applyButton.createSpan({ text: "Применить к выбранным" });
        applyButton.disabled = this.bulkSelectedPaths.size === 0;
        applyButton.addEventListener("click", () => {
            const files = this.bulkVisibleFiles.filter((file) => this.bulkSelectedPaths.has(file.path));
            if (files.length === 0) {
                new Notice("Сначала выберите заметки для изменения.");
                return;
            }
            const payload = this.parseBulkOperation();
            if (!payload)
                return;
            let operationTitle = "";
            let operationDetails = "";
            const tagList = (tags) => tags.map((tag) => `#${tag}`).join(", ");
            if (payload.kind === "add") {
                operationTitle = "Добавление тегов";
                operationDetails = payload.alwaysYaml
                    ? `Добавить ${tagList(payload.tags)} в YAML-атрибут tag/tags. Если атрибутов нет, будет создано поле tags.`
                    : `Добавить ${tagList(payload.tags)}. Если в заметке есть YAML-поле tag/tags, оно будет расширено; иначе теги будут добавлены в текст записи.`;
            }
            else if (payload.kind === "rename") {
                operationTitle = "Переименование тегов";
                operationDetails = payload.changes.map((change) => `#${change.oldTag} → #${change.newTag}`).join("; ");
            }
            else if (payload.kind === "delete") {
                operationTitle = "Удаление тегов";
                operationDetails = `Удалить ${tagList(payload.changes.map((change) => change.oldTag))} из выбранных заметок.`;
            }
            else if (payload.kind === "to-yaml") {
                operationTitle = "Перенос тегов из текста в свойства";
                operationDetails = payload.tags.length ? `Перенести ${tagList(payload.tags)} из текста в YAML-свойство tags.` : "Перенести все теги из текста в YAML-свойство tags.";
            }
            else {
                operationTitle = "Перенос тегов из свойств в текст";
                operationDetails = payload.tags.length ? `Перенести ${tagList(payload.tags)} из YAML tag/tags в текст заметки.` : "Перенести все теги из YAML tag/tags в текст заметки.";
            }
            const withPosts = payload.posts ? Object.keys(payload.posts).length : 0;
            if (withPosts)
                operationDetails += ` В ${withPosts} ${pluralRu(withPosts, "заметке", "заметках", "заметках")} изменения затронут только выбранные записи.`;
            new BulkApplyConfirmModal(this.plugin.app, this.plugin, {
                files,
                title: operationTitle,
                details: operationDetails,
                isDestructive: payload.kind !== "add",
                transform: this.plugin.buildBulkTransform(payload),
                onConfirm: async (selectedFiles) => {
                    await this.plugin.applyBulkTagOperation(selectedFiles, payload);
                    this.bulkSelectedPaths.clear();
                    this.bulkPostSelection.clear();
                    this.render();
                },
            }).open();
        });

        const results = layout.createDiv({ cls: "tra-bulk-results-card" });
        const resultsHeader = results.createDiv({ cls: "tra-bulk-results-header" });
        const resultsHeading = resultsHeader.createDiv({ cls: "tra-bulk-card-heading" });
        setIcon(resultsHeading.createSpan({ cls: "tra-bulk-heading-icon" }), "files");
        resultsHeading.createEl("h3", { text: "Заметки" });
        const resultsActions = resultsHeader.createDiv({ cls: "tra-bulk-results-actions" });
        const sortSelect = resultsActions.createEl("select", { cls: "tra-bulk-input tra-bulk-sort-select", attr: { "aria-label": "Сортировка заметок по дате", title: "Сортировка заметок по дате" } });
        sortSelect.createEl("option", { text: "Сначала новые", attr: { value: "newest" } });
        sortSelect.createEl("option", { text: "Сначала старые", attr: { value: "oldest" } });
        sortSelect.value = this.bulkDateSort;
        sortSelect.addEventListener("change", () => {
            this.bulkDateSort = sortSelect.value;
            if (!this.bulkFilterApplied)
                return;
            this.bulkVisibleFiles = [...this.bulkVisibleFiles].sort((a, b) => this.compareByCreation(a, b));
            const noteList = this.contentEl.querySelector(".tra-bulk-note-list");
            if (!noteList || this.bulkVisibleFiles.length === 0)
                return;
            noteList.scrollTop = 0;
            this.renderBulkNoteCards(noteList, this.bulkVisibleFiles);
        });
        const countBadge = resultsActions.createSpan({ cls: "tra-bulk-results-count", text: "0" });
        this.bulkVisibleFiles = this.bulkFilterApplied ? this.getBulkFilteredFiles() : [];
        const visiblePaths = new Set(this.bulkVisibleFiles.map((file) => file.path));
        for (const selectedPath of this.bulkSelectedPaths) {
            if (!visiblePaths.has(selectedPath))
                this.bulkSelectedPaths.delete(selectedPath);
        }
        // Same controls as on the "Аудит тегов" page.
        const selectionBar = results.createDiv({ cls: "tra-note-selection-bar tra-bulk-selection-bar" });
        const selectAll = selectionBar.createEl("button", { cls: "tra-secondary-button tra-bulk-select-all", attr: { type: "button" } });
        setIcon(selectAll.createSpan({ cls: "tra-button-icon" }), "check-check");
        selectAll.createSpan({ text: "Выбрать все" });
        const selectNone = selectionBar.createEl("button", { cls: "tra-secondary-button tra-bulk-clear-selection", attr: { type: "button" } });
        setIcon(selectNone.createSpan({ cls: "tra-button-icon" }), "circle-x");
        selectNone.createSpan({ text: "Снять все" });
        selectionBar.createSpan({ cls: "tra-note-selection-count tra-bulk-selection-count" });
        selectionBar.createSpan({ cls: "tra-note-selection-hint", text: "Шапка карточки — выбрать заметку, текст — открыть её." });
        selectAll.addEventListener("click", () => {
            for (const file of this.bulkVisibleFiles)
                this.bulkSelectedPaths.add(file.path);
            this.syncBulkSelectionUI();
        });
        selectNone.addEventListener("click", () => {
            this.bulkSelectedPaths.clear();
            this.syncBulkSelectionUI();
        });
        const list = results.createDiv({ cls: "tra-bulk-note-list" });
        if (!this.bulkFilterApplied) {
            list.createDiv({ cls: "tra-bulk-empty tra-bulk-filter-placeholder", text: "Настройте даты и тег (или оставьте «Любые теги») и нажмите «Применить фильтр», чтобы загрузить карточки заметок." });
        }
        else if (this.bulkDateFrom && this.bulkDateTo && this.bulkDateFrom > this.bulkDateTo) {
            list.createDiv({ cls: "tra-bulk-empty", text: "Проверьте диапазон дат: начало позже окончания." });
        }
        else if (this.bulkVisibleFiles.length === 0) {
            const empty = list.createDiv({ cls: "tra-bulk-empty" });
            empty.createDiv({ text: "Нет заметок, подходящих под выбранный период." });
            empty.createDiv({ cls: "tra-bulk-empty-details", text: this.describeDateStats() });
        }
        else {
            this.renderBulkNoteCards(list, this.bulkVisibleFiles);
        }
        countBadge.setText(this.bulkFilterApplied ? String(this.bulkVisibleFiles.length) : "—");
        this.syncBulkSelectionUI();
    }
    parseBulkOperation() {
        const payload = this.parseBulkOperationKind();
        if (!payload)
            return null;
        // Chosen records of the selected notes.
        for (const [path, selection] of this.bulkPostSelection) {
            if (!this.bulkSelectedPaths.has(path))
                continue;
            payload.posts ??= {};
            payload.posts[path] = { indices: [...selection.indices], count: selection.count };
        }
        return payload;
    }
    parseBulkOperationKind() {
        const splitTags = (value) => value.split(/[\s,;]+/).map((item) => normalizeTag(cleanTagInput(item))).filter(Boolean);
        const validate = (tag) => {
            if (!isValidTag(tag)) {
                new Notice(`Некорректное имя тега «${tag}». Допустимы буквы, цифры, _ , - и / для вложенности.`);
                return false;
            }
            return true;
        };
        if (this.bulkAction === "add") {
            const tags = [];
            const seen = new Set();
            for (const tag of splitTags(this.bulkInputs.add)) {
                if (!validate(tag))
                    return null;
                const key = tagKey(tag, this.plugin.settings.caseSensitive);
                if (!seen.has(key)) {
                    seen.add(key);
                    tags.push(tag);
                }
            }
            if (tags.length === 0) {
                new Notice("Укажите хотя бы один тег для добавления.");
                return null;
            }
            return { kind: "add", tags, alwaysYaml: this.bulkAlwaysAddToAttributes };
        }
        if (this.bulkAction === "to-yaml" || this.bulkAction === "to-text") {
            const tags = [];
            for (const tag of splitTags(this.bulkInputs.move ?? "")) {
                if (!validate(tag))
                    return null;
                if (!tags.some((value) => tagKey(value, this.plugin.settings.caseSensitive) === tagKey(tag, this.plugin.settings.caseSensitive)))
                    tags.push(tag);
            }
            return { kind: this.bulkAction, tags };
        }
        if (this.bulkAction === "delete") {
            const tags = [];
            const seen = new Set();
            for (const tag of splitTags(this.bulkInputs.delete)) {
                if (!validate(tag))
                    return null;
                const key = tagKey(tag, this.plugin.settings.caseSensitive);
                if (!seen.has(key)) {
                    seen.add(key);
                    tags.push(tag);
                }
            }
            if (tags.length === 0) {
                new Notice("Укажите хотя бы один тег для удаления.");
                return null;
            }
            return { kind: "delete", changes: tags.map((oldTag) => ({ oldTag, newTag: null, action: "delete" })) };
        }
        const changes = [];
        const seen = new Set();
        const lines = this.bulkInputs.rename.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        for (const line of lines) {
            const parts = line.split(/\s*(?:->|→|=>)\s*/);
            if (parts.length !== 2) {
                new Notice(`Не удалось разобрать строку «${line}». Используйте формат: старый-тег -> новый-тег.`);
                return null;
            }
            const oldTag = normalizeTag(cleanTagInput(parts[0]));
            const newTag = normalizeTag(cleanTagInput(parts[1]));
            if (!oldTag || !newTag || !validate(oldTag) || !validate(newTag))
                return null;
            if (tagKey(oldTag, this.plugin.settings.caseSensitive) === tagKey(newTag, this.plugin.settings.caseSensitive)) {
                new Notice(`Старый и новый теги совпадают: #${oldTag}.`);
                return null;
            }
            const key = tagKey(oldTag, this.plugin.settings.caseSensitive);
            if (seen.has(key)) {
                new Notice(`Тег #${oldTag} указан для переименования несколько раз.`);
                return null;
            }
            seen.add(key);
            changes.push({ oldTag, newTag, action: "rename" });
        }
        if (changes.length === 0) {
            new Notice("Укажите пары тегов в формате старый-тег -> новый-тег.");
            return null;
        }
        return { kind: "rename", changes };
    }
    /**
     * Cards are added in pages and their Markdown previews are rendered only
     * when scrolled into view, so filtering thousands of notes stays fast.
     * Selection works on the full filtered list, not only on rendered cards.
     */
    renderBulkNoteCards(parent, files) {
        parent.empty();
        const limit = Math.min(files.length, Math.max(BULK_PAGE_SIZE, this.bulkRenderLimit));
        this.appendBulkNoteCards(parent, files, 0, limit);
    }
    appendBulkNoteCards(parent, files, from, to) {
        for (const file of files.slice(from, to)) {
            const selected = this.bulkSelectedPaths.has(file.path);
            const card = parent.createDiv({
                cls: `tra-bulk-note-card${selected ? " is-selected" : ""}`,
                attr: { tabindex: "0", "aria-label": `Заметка ${file.basename}: Enter — открыть, пробел — выбрать`, "data-path": file.path },
            });
            const header = card.createDiv({ cls: "tra-bulk-note-header", attr: { title: "Выбрать или снять выбор" } });
            const checkbox = header.createEl("input", { cls: "tra-file-check tra-bulk-check", attr: { type: "checkbox", title: "Изменять эту заметку", "aria-label": `Изменять заметку ${file.basename}` } });
            checkbox.checked = selected;
            checkbox.addEventListener("click", (event) => event.stopPropagation());
            checkbox.addEventListener("change", () => {
                if (checkbox.checked !== this.bulkSelectedPaths.has(file.path))
                    this.toggleBulkFile(file.path);
            });
            const title = header.createDiv({ cls: "tra-bulk-note-title" });
            title.createEl("strong", { text: file.basename });
            title.createDiv({ cls: "tra-bulk-note-path", text: file.path });
            const created = this.getNoteCreationTimestamp(file);
            title.createDiv({ cls: "tra-bulk-note-date", text: created ? new Date(created).toLocaleDateString() : "Без даты" });
            title.createSpan({ cls: "tra-post-badge" });
            const openPreview = () => new NotePreviewModal(this.plugin.app, file, {
                plugin: this.plugin,
                selection: {
                    isSelected: () => this.bulkSelectedPaths.has(file.path),
                    toggle: () => this.toggleBulkFile(file.path),
                },
                posts: {
                    get: () => this.bulkPostSelection.get(file.path) ?? null,
                    set: (value) => {
                        if (value)
                            this.bulkPostSelection.set(file.path, value);
                        else
                            this.bulkPostSelection.delete(file.path);
                        this.syncBulkSelectionUI();
                    },
                },
            }).open();
            // Two click zones: the header (title, path, date) toggles the
            // checkbox, the text and tags open the note in a window.
            card.addEventListener("click", (event) => {
                const target = event.target instanceof Element ? event.target : null;
                if (target?.closest("a.external-link, .tra-file-check"))
                    return;
                if (target?.closest(".tra-bulk-note-header"))
                    this.toggleBulkFile(file.path);
                else
                    openPreview();
            });
            card.addEventListener("keydown", (event) => {
                if (event.target !== card)
                    return;
                if (event.key === "Enter") {
                    event.preventDefault();
                    openPreview();
                }
                else if (event.key === " ") {
                    event.preventDefault();
                    this.toggleBulkFile(file.path);
                }
            });
            const excerpt = card.createDiv({ cls: "tra-bulk-note-excerpt markdown-rendered", text: "Загрузка предпросмотра…", attr: { title: "Открыть заметку" } });
            const tagsFooter = card.createDiv({ cls: "tra-bulk-note-footer" });
            const tagsLabel = tagsFooter.createSpan({ cls: "tra-bulk-tags-label", text: "Теги" });
            const tags = this.getTagsForFile(file);
            const tagsWrap = tagsFooter.createDiv({ cls: "tra-bulk-note-tags" });
            if (tags.length === 0) {
                tagsWrap.createSpan({ cls: "tra-bulk-no-tags", text: "Нет тегов" });
            }
            else {
                for (const tag of tags) {
                    const chip = tagsWrap.createSpan({ cls: "tra-bulk-tag-chip" });
                    chip.createSpan({ cls: "tra-tag-hash", text: "#" });
                    chip.createSpan({ text: tag });
                }
            }
            this.renderWhenVisible(excerpt, () => this.renderBulkExcerpt(excerpt, file));
        }
        if (to < files.length) {
            const more = parent.createEl("button", {
                cls: "tra-show-more tra-bulk-show-more",
                text: `Показать ещё ${Math.min(BULK_PAGE_SIZE, files.length - to)} из ${files.length - to}`,
                attr: { type: "button" },
            });
            more.addEventListener("click", () => {
                more.remove();
                const next = Math.min(files.length, to + BULK_PAGE_SIZE);
                this.bulkRenderLimit = next;
                this.appendBulkNoteCards(parent, files, to, next);
                this.syncBulkSelectionUI();
            });
        }
    }
    async renderBulkExcerpt(parent, file) {
        const component = this.renderComponent;
        try {
            const raw = await this.plugin.app.vault.cachedRead(file);
            if (!parent.isConnected || component !== this.renderComponent)
                return;
            const body = stripFrontmatter(raw).trim();
            const maxChars = Math.min(320, this.plugin.settings.previewChars || 320);
            let excerpt = body.slice(0, maxChars);
            if (body.length > maxChars)
                excerpt = `${excerpt.trimEnd()}…`;
            parent.empty();
            if (!excerpt) {
                parent.createDiv({ cls: "tra-bulk-excerpt-empty", text: "Пустая заметка" });
                return;
            }
            await MarkdownRenderer.render(this.plugin.app, excerpt, parent, file.path, component);
        }
        catch {
            if (parent.isConnected)
                parent.setText("Не удалось загрузить предпросмотр заметки.");
        }
    }
    toggleBulkFile(path) {
        if (this.bulkSelectedPaths.has(path))
            this.bulkSelectedPaths.delete(path);
        else
            this.bulkSelectedPaths.add(path);
        this.syncBulkSelectionUI();
    }
    syncBulkSelectionUI() {
        const root = this.contentEl;
        const count = this.bulkSelectedPaths.size;
        const total = this.bulkVisibleFiles.length;
        const countEl = root.querySelector(".tra-bulk-selected-count");
        if (countEl)
            countEl.textContent = `Выбрано ${count} ${pluralRu(count, "заметка", "заметки", "заметок")}`;
        const barCount = root.querySelector(".tra-bulk-selection-count");
        if (barCount)
            barCount.textContent = this.bulkFilterApplied ? `Выбрано ${count} из ${total}` : "Сначала примените фильтр";
        const selectAllButton = root.querySelector(".tra-bulk-select-all");
        if (selectAllButton)
            selectAllButton.disabled = total === 0 || count === total;
        const clearButton = root.querySelector(".tra-bulk-clear-selection");
        if (clearButton)
            clearButton.disabled = count === 0;
        const applyButton = root.querySelector(".tra-bulk-apply");
        if (applyButton)
            applyButton.disabled = count === 0;
        for (const card of Array.from(root.querySelectorAll(".tra-bulk-note-card"))) {
            const path = card.getAttribute("data-path");
            const isSelected = Boolean(path && this.bulkSelectedPaths.has(path));
            card.classList.toggle("is-selected", isSelected);
            updatePostBadge(card, isSelected ? this.bulkPostSelection.get(path) : null);
            const checkbox = card.querySelector(".tra-bulk-check");
            if (checkbox)
                checkbox.checked = isSelected;
        }
    }
    fillDateSourceOptions(select) {
        const settings = this.plugin.settings;
        const property = (settings.createdDateProperty ?? "").trim();
        select.createEl("option", { text: "Дата создания файла", attr: { value: "ctime" } });
        select.createEl("option", { text: "Дата изменения файла", attr: { value: "mtime" } });
        const candidates = this.plugin.getDateFieldCandidates();
        if (property && !candidates.some((item) => item.key === property))
            candidates.unshift({ key: property, count: null });
        if (candidates.length > 0) {
            const group = select.createEl("optgroup", { attr: { label: "Свойство YAML" } });
            for (const item of candidates)
                group.createEl("option", { text: item.count === null ? item.key : `${item.key} (${item.count})`, attr: { value: item.key } });
        }
        select.value = property || (settings.fileDateField === "mtime" ? "mtime" : "ctime");
    }
    /** Date coverage of the current source: how many notes have a date and their range. */
    getDateStats() {
        const isIgnored = makeIgnoredPathMatcher(this.plugin.settings.ignoredFolders ?? []);
        let total = 0;
        let dated = 0;
        let min = Infinity;
        let max = -Infinity;
        for (const file of this.plugin.app.vault.getMarkdownFiles()) {
            if (isIgnored(file.path))
                continue;
            total += 1;
            const time = this.getNoteCreationTimestamp(file);
            if (!time)
                continue;
            dated += 1;
            min = Math.min(min, time);
            max = Math.max(max, time);
        }
        return { total, dated, min, max };
    }
    describeDateStats() {
        const { total, dated, min, max } = this.getDateStats();
        const source = this.plugin.describeDateSource();
        if (dated === 0)
            return `Источник: ${source}. Ни у одной из ${total} заметок нет даты в этом источнике — выберите другой источник даты.`;
        const range = `с ${new Date(min).toLocaleDateString()} по ${new Date(max).toLocaleDateString()}`;
        return `Источник: ${source}. Дата есть у ${dated} из ${total} заметок, ${range}.`;
    }
    renderDateStats(el) {
        el.empty();
        el.createDiv({ text: this.describeDateStats() });
        const property = (this.plugin.settings.createdDateProperty ?? "").trim();
        const candidates = this.plugin.getDateFieldCandidates();
        if (!property && this.plugin.settings.fileDateField !== "mtime" && candidates.length > 0) {
            el.createDiv({
                cls: "tra-bulk-hint-warning",
                text: `Дату создания файла часто сбрасывают синхронизация и копирование. В заметках найдено свойство с датами «${candidates[0].key}» — его можно выбрать выше.`,
            });
        }
    }
}

module.exports = { BulkPageMixin };
