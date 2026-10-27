"use strict";
/** Страница «Аудит тегов»: каталог тегов, карточка выбранного тега, предпросмотры и очередь. */
const { MarkdownRenderer, setIcon } = require("obsidian");
const { BULK_PAGE_SIZE, CATALOG_PAGE_SIZE, PREVIEW_PAGE_SIZE } = require("../constants.js");
const { ApplyConfirmModal } = require("../modals/apply-confirm-modal.js");
const { NotePreviewModal } = require("../modals/note-preview-modal.js");
const { stripFrontmatter } = require("../tags/frontmatter.js");
const { findInlineTagIndex } = require("../tags/markdown.js");
const { cleanTagInput, isValidTag, tagKey } = require("../tags/tag-name.js");
const { findTextIndex, highlightTagInElement, pluralRu, updatePostBadge } = require("../utils.js");

/** Методы подмешиваются в TagAuditorView. */
class AuditPageMixin {
    renderAuditPage(shell, previousTagListScrollTop) {
        const workspace = shell.createDiv({ cls: "tra-bento-grid" });
        const tagBrowser = workspace.createDiv({ cls: "tra-tag-browser-card" });
        const searchWrap = tagBrowser.createDiv({ cls: "tra-search-wrap" });
        const searchIcon = searchWrap.createDiv({ cls: "tra-search-icon" });
        setIcon(searchIcon, "search");
        const search = searchWrap.createEl("input", {
            cls: "tra-search",
            attr: { type: "text", placeholder: "Найти тег…", "aria-label": "Поиск тегов", "data-tra-field": "search" },
        });
        search.value = this.query;
        const clearButton = searchWrap.createEl("button", {
            cls: "tra-search-clear",
            attr: { type: "button", "aria-label": "Очистить поиск", title: "Очистить поле поиска" },
        });
        setIcon(clearButton, "x");

        const listHeader = tagBrowser.createDiv({ cls: "tra-section-heading" });
        listHeader.createEl("span", { text: "Теги" });
        const tagTotal = listHeader.createSpan({ cls: "tra-tag-total", text: String(this.plugin.tagIndex.size) });

        const sortControl = tagBrowser.createDiv({ cls: "tra-sort-control" });
        const sortLabel = sortControl.createEl("label", { cls: "tra-sort-label", text: "Сортировка тегов" });
        const sortSelect = sortControl.createEl("select", {
            cls: "tra-sort-select",
            attr: {
                "aria-label": "Сортировка тегов",
                title: "Сортировка по самой поздней дате создания заметки с тегом. Источник даты задаётся в настройках.",
            },
        });
        sortLabel.setAttr("for", sortSelect.id = `tra-sort-${Math.random().toString(36).slice(2, 9)}`);
        const sortOptions = [
            ["name", "По названию"],
            ["recent", "По дате создания заметки"],
            ["count", "По количеству заметок"],
        ];
        for (const [value, label] of sortOptions)
            sortSelect.createEl("option", { text: label, attr: { value } });
        sortSelect.value = this.sortMode;

        const mentionFilter = tagBrowser.createDiv({ cls: "tra-mention-filter" });
        const mentionLabel = mentionFilter.createEl("label", {
            cls: "tra-sort-label",
            text: "Порог упоминаний (число заметок)",
        });
        const mentionInput = mentionFilter.createEl("input", {
            cls: "tra-threshold-input",
            attr: {
                type: "number",
                min: "0",
                step: "1",
                placeholder: "0",
                title: "Пусто или 0 — показывать все теги",
                "aria-label": "Минимальное число заметок с тегом",
                "data-tra-field": "min-mentions",
            },
        });
        mentionInput.value = String(this.plugin.settings.minTagMentions ?? 0);
        mentionLabel.setAttr("for", mentionInput.id = `tra-min-mentions-${Math.random().toString(36).slice(2, 9)}`);

        const alphabetNav = tagBrowser.createDiv({
            cls: "tra-alpha-nav",
            attr: { "aria-label": "Переход к тегам по первой букве" },
        });
        const list = tagBrowser.createDiv({ cls: "tra-tag-list" });
        const renderList = () => {
            tagTotal.setText(String(this.renderTagRows(list, search.value, alphabetNav)));
        };
        const updateSearchClearButton = () => {
            clearButton.style.display = search.value.length > 0 ? "flex" : "none";
        };
        list.addEventListener("scroll", () => {
            this.tagListScrollTop = list.scrollTop;
        }, { passive: true });
        // Re-filter once typing pauses instead of rebuilding the catalog on every key.
        let searchTimer = null;
        search.addEventListener("input", () => {
            this.query = search.value;
            updateSearchClearButton();
            if (searchTimer !== null)
                window.clearTimeout(searchTimer);
            searchTimer = window.setTimeout(() => {
                searchTimer = null;
                if (list.isConnected)
                    renderList();
            }, 120);
        });
        clearButton.addEventListener("click", () => {
            search.value = "";
            this.query = "";
            updateSearchClearButton();
            renderList();
            search.focus();
        });
        sortSelect.addEventListener("change", () => {
            this.sortMode = sortSelect.value;
            renderList();
        });
        mentionInput.addEventListener("input", () => {
            const raw = mentionInput.value.trim();
            const parsed = raw === "" ? 0 : Number.parseInt(raw, 10);
            this.plugin.settings.minTagMentions = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
            renderList();
            void this.plugin.saveData(this.plugin.settings);
        });
        updateSearchClearButton();
        renderList();
        // Restore after layout has been recalculated. The animation-frame restore
        // avoids browsers resetting scrollTop while the new tag rows are measured.
        // Rows are rendered in portions, so render enough of them first.
        this.ensureCatalogHeight(previousTagListScrollTop);
        list.scrollTop = previousTagListScrollTop;
        window.requestAnimationFrame(() => {
            if (list.isConnected) {
                this.ensureCatalogHeight(previousTagListScrollTop);
                list.scrollTop = previousTagListScrollTop;
            }
        });

        // Bento layout: tag browser occupies the left column; preview and queue
        // are separate cards in the right column.
        // The right column is one flex stack, so a tall tag catalog on the left no
        // longer stretches the grid rows and pushes the queue card down.
        const side = workspace.createDiv({ cls: "tra-side-column" });
        this.renderSelectedTag(side);
        this.renderPendingChanges(side);
    }
    renderTagRows(parent, query, alphabetNav) {
        parent.empty();
        const normalizedQuery = query.trim().replace(/^#/, "").toLocaleLowerCase();
        const configuredThreshold = Number(this.plugin.settings.minTagMentions ?? 0);
        const threshold = Number.isFinite(configuredThreshold) ? Math.max(0, Math.floor(configuredThreshold)) : 0;
        const entries = [...this.plugin.tagIndex.values()].filter((info) => info.files.length >= threshold && info.tag.toLocaleLowerCase().includes(normalizedQuery));
        // The index is already sorted by name; keep that order as a stable tie-breaker.
        const position = new Map();
        let indexPosition = 0;
        for (const key of this.plugin.tagIndex.keys())
            position.set(key, indexPosition++);
        const compareByName = (a, b) => (position.get(a.key) ?? 0) - (position.get(b.key) ?? 0);
        if (this.sortMode === "count") {
            entries.sort((a, b) => b.files.length - a.files.length || compareByName(a, b));
        }
        else if (this.sortMode === "recent") {
            // Sort each tag by the newest creation date among notes containing it.
            // Date source: configured YAML property, or file ctime when the setting is empty.
            const latestTimes = new Map(entries.map((info) => [
                info.key,
                info.files.reduce((latest, file) => Math.max(latest, this.getNoteCreationTimestamp(file)), 0),
            ]));
            entries.sort((a, b) => (latestTimes.get(b.key) ?? 0) - (latestTimes.get(a.key) ?? 0) || compareByName(a, b));
        }
        // Build case-insensitive alphabet shortcuts from the currently visible tags.
        // Only letters present in the filtered result set are shown.
        alphabetNav.empty();
        const initials = new Map();
        for (const info of entries) {
            const first = Array.from(info.tag.trim())[0];
            if (!first || !/^\p{L}$/u.test(first))
                continue;
            const key = first.toLocaleLowerCase();
            if (!initials.has(key))
                initials.set(key, first.toLocaleUpperCase());
        }
        const orderedInitials = [...initials.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" }));
        for (const [key, label] of orderedInitials) {
            const shortcut = alphabetNav.createEl("button", {
                cls: "tra-alpha-button",
                text: label,
                attr: {
                    type: "button",
                    title: `Перейти к тегам на букву ${label}`,
                    "aria-label": `Перейти к тегам на букву ${label}`,
                },
            });
            shortcut.addEventListener("click", () => {
                const index = entries.findIndex((info) => Array.from(info.tag.trim())[0]?.toLocaleLowerCase() === key);
                if (index < 0)
                    return;
                this.ensureCatalogRows(index + 1);
                const target = parent.querySelector(`.tra-tag-row[data-index="${index}"]`);
                if (!target)
                    return;
                const listRect = parent.getBoundingClientRect();
                const targetRect = target.getBoundingClientRect();
                const targetTop = parent.scrollTop + targetRect.top - listRect.top;
                parent.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
            });
        }
        alphabetNav.style.display = orderedInitials.length > 0 ? "flex" : "none";

        if (entries.length === 0) {
            const empty = parent.createDiv({ cls: "tra-empty" });
            const icon = empty.createDiv({ cls: "tra-empty-icon" });
            setIcon(icon, normalizedQuery ? "search-x" : "tags");
            empty.createEl("p", { text: normalizedQuery || threshold > 0 ? "Ничего не найдено" : "Теги не найдены" });
            empty.createEl("span", { text: normalizedQuery || threshold > 0 ? "Измените поиск или уменьшите порог упоминаний." : "После сканирования здесь появятся теги из заметок." });
            return 0;
        }
        // Rows are added in portions as the list is scrolled: a catalog of
        // thousands of tags opens and filters instantly, also on phones.
        this.catalog?.observer?.disconnect();
        this.catalog = { parent, entries, rendered: 0, sentinel: null, observer: null };
        if (!parent.dataset.traBound) {
            // One delegated handler for all rows instead of one per row.
            parent.dataset.traBound = "1";
            parent.addEventListener("click", (event) => {
                const row = event.target instanceof Element ? event.target.closest(".tra-tag-row") : null;
                const info = row ? this.catalog?.entries[Number(row.getAttribute("data-index"))] : null;
                if (!info)
                    return;
                this.selectedTag = info.tag;
                this.showAllPreviews = false;
                this.render();
            });
        }
        this.ensureCatalogRows(CATALOG_PAGE_SIZE);
        return entries.length;
    }
    /** Render catalog rows until at least `count` are in the DOM. */
    ensureCatalogRows(count) {
        const catalog = this.catalog;
        if (!catalog || !catalog.parent.isConnected && catalog.rendered > 0)
            return;
        const { parent, entries } = catalog;
        const target = Math.min(entries.length, count);
        if (catalog.rendered >= target)
            return;
        catalog.sentinel?.remove();
        const caseSensitive = this.plugin.settings.caseSensitive;
        const selectedKey = this.selectedTag !== null ? tagKey(this.selectedTag, caseSensitive) : null;
        const fragment = document.createDocumentFragment();
        for (let index = catalog.rendered; index < target; index += 1) {
            const info = entries[index];
            const isPending = this.plugin.pendingChanges.has(info.key) || this.plugin.pendingAdditions.has(info.key);
            const row = document.createElement("button");
            row.className = `tra-tag-row${info.key === selectedKey ? " is-selected" : ""}${isPending ? " is-pending" : ""}`;
            row.type = "button";
            row.setAttribute("data-index", String(index));
            row.title = `#${info.tag} — ${info.files.length} ${pluralRu(info.files.length, "заметка", "заметки", "заметок")}`;
            const hash = document.createElement("span");
            hash.className = "tra-tag-hash";
            hash.textContent = "#";
            hash.setAttribute("aria-hidden", "true");
            const name = document.createElement("span");
            name.className = "tra-tag-name";
            name.textContent = info.tag;
            row.append(hash, name);
            if (isPending) {
                const pendingMark = document.createElement("span");
                pendingMark.className = "tra-pending-dot";
                pendingMark.setAttribute("aria-label", "На изменение");
                row.append(pendingMark);
            }
            const count = document.createElement("span");
            count.className = "tra-tag-count";
            count.textContent = String(info.files.length);
            row.append(count);
            fragment.append(row);
        }
        parent.append(fragment);
        catalog.rendered = target;
        if (catalog.rendered < entries.length) {
            const sentinel = parent.createDiv({ cls: "tra-tag-sentinel", text: `Ещё ${entries.length - catalog.rendered}…` });
            catalog.sentinel = sentinel;
            if (typeof IntersectionObserver !== "undefined") {
                catalog.observer?.disconnect();
                catalog.observer = new IntersectionObserver((items) => {
                    if (items.some((item) => item.isIntersecting))
                        this.ensureCatalogRows(catalog.rendered + CATALOG_PAGE_SIZE);
                }, { root: parent, rootMargin: "400px 0px" });
                catalog.observer.observe(sentinel);
            }
            else {
                sentinel.addEventListener("click", () => this.ensureCatalogRows(catalog.rendered + CATALOG_PAGE_SIZE));
            }
        }
        else {
            catalog.observer?.disconnect();
            catalog.sentinel = null;
        }
    }
    /** Render enough rows for the list to be scrolled to `scrollTop`. */
    ensureCatalogHeight(scrollTop) {
        const catalog = this.catalog;
        if (!catalog)
            return;
        let guard = 0;
        while (catalog.rendered < catalog.entries.length
            && catalog.parent.scrollHeight < scrollTop + catalog.parent.clientHeight + 200
            && guard < 50) {
            this.ensureCatalogRows(catalog.rendered + CATALOG_PAGE_SIZE);
            guard += 1;
        }
    }
    renderSelectedTag(root) {
        if (this.selectedTag && !this.plugin.getTagInfo(this.selectedTag))
            this.selectedTag = null;
        if (!this.selectedTag) {
            const tip = root.createDiv({ cls: "tra-select-prompt" });
            const icon = tip.createDiv({ cls: "tra-select-icon" });
            setIcon(icon, "mouse-pointer-click");
            tip.createEl("strong", { text: "Выберите тег" });
            tip.createEl("p", { text: "Посмотрите, где он используется, и добавьте переименование в очередь." });
            return;
        }
        const info = this.plugin.getTagInfo(this.selectedTag);
        // Drafts survive re-renders (index updates while typing) but not a tag switch.
        if (this.renameDraft.tag !== info.key)
            this.renameDraft = { tag: info.key, value: "", addTags: "" };
        const selectedNotes = this.getNoteSelection(info);
        const card = root.createDiv({ cls: "tra-selected-card" });
        const selectedHeader = card.createDiv({ cls: "tra-selected-header" });
        const selectedTitle = selectedHeader.createDiv({ cls: "tra-selected-title" });
        selectedTitle.createEl("span", { cls: "tra-tag-hash", text: "#" });
        selectedTitle.createEl("h3", { text: info.tag });
        selectedHeader.createEl("span", { cls: "tra-count-pill", text: `${info.files.length} ${pluralRu(info.files.length, "заметка", "заметки", "заметок")}` });
        const form = card.createDiv({ cls: "tra-rename-form" });
        const label = form.createEl("label", { text: "Новое имя тега", cls: "tra-field-label" });
        const fieldRow = form.createDiv({ cls: "tra-field-row" });
        const hashPrefix = fieldRow.createSpan({ cls: "tra-input-prefix", text: "#" });
        hashPrefix.setAttr("aria-hidden", "true");
        const input = fieldRow.createEl("input", {
            cls: "tra-rename-input",
            attr: { type: "text", placeholder: "новый-тег", autocomplete: "off", spellcheck: "false", "data-tra-field": "rename" },
        });
        input.value = this.renameDraft.value;
        label.setAttr("for", input.id = `tra-rename-${Math.random().toString(36).slice(2, 9)}`);
        const addButton = fieldRow.createEl("button", { cls: "tra-primary-button tra-add-button", text: "В очередь" });
        addButton.type = "button";
        const warning = form.createDiv({ cls: "tra-inline-warning" });
        form.createDiv({ cls: "tra-scope-hint" });
        const addTagsSection = form.createDiv({ cls: "tra-add-tags-section" });
        const addTagsLabel = addTagsSection.createEl("label", {
            cls: "tra-field-label",
            text: `Добавить несколько тегов к заметкам с #${info.tag}`,
        });
        const addTagsRow = addTagsSection.createDiv({ cls: "tra-add-tags-row" });
        const addTagsInput = addTagsRow.createEl("textarea", {
            cls: "tra-add-tags-input",
            attr: {
                rows: "2",
                placeholder: "новый-тег1, новый-тег2",
                autocomplete: "off",
                spellcheck: "false",
                "aria-label": "Список добавляемых тегов",
                "data-tra-field": "add-tags",
            },
        });
        addTagsInput.value = this.renameDraft.addTags;
        addTagsInput.addEventListener("input", () => { this.renameDraft.addTags = addTagsInput.value; });
        addTagsLabel.setAttr("for", addTagsInput.id = `tra-add-tags-${Math.random().toString(36).slice(2, 9)}`);
        const addTagsButton = addTagsRow.createEl("button", {
            cls: "tra-primary-button tra-add-tags-submit",
            text: "Добавить в очередь",
            attr: { type: "button" },
        });
        addTagsSection.createEl("small", {
            cls: "tra-add-tags-help",
            text: "Разделяйте теги пробелами, запятыми или переносами строк. В YAML список расширяется; для тегов в тексте новые теги добавляются в конце соответствующей записи перед разделителем ---.",
        });
        addTagsButton.addEventListener("click", () => {
            if (this.plugin.addMultipleTagsChange(info.tag, addTagsInput.value, selectedNotes, this.postSelection)) {
                this.renameDraft.addTags = "";
                this.render();
            }
        });
        const destructiveActions = form.createDiv({ cls: "tra-destructive-actions" });
        const deleteButton = destructiveActions.createEl("button", {
            cls: "tra-danger-button",
            attr: { type: "button", title: `Добавить удаление #${info.tag} в очередь` },
        });
        const deleteIcon = deleteButton.createSpan({ cls: "tra-button-icon" });
        setIcon(deleteIcon, "trash-2");
        deleteButton.createSpan({ text: "Удалить тег из всех заметок" });
        const unmarkButton = destructiveActions.createEl("button", {
            cls: "tra-secondary-button tra-unmark-button",
            attr: { type: "button", title: `Сохранить # у #${info.tag} как обычный текст, не как тег` },
        });
        const unmarkIcon = unmarkButton.createSpan({ cls: "tra-button-icon" });
        setIcon(unmarkIcon, "hash");
        unmarkButton.createSpan({ text: "Оставить # как обычный текст" });
        destructiveActions.createEl("small", { text: "В тексте #тег останется видимым, но решётка будет экранирована обратным слешем (\\#тег), чтобы Obsidian не распознавал её как тег; запись из YAML tags/tag будет удалена из метаданных." });
        deleteButton.addEventListener("click", () => this.plugin.addDeleteTagChange(info.tag, selectedNotes, this.postSelection));
        unmarkButton.addEventListener("click", () => this.plugin.addUnmarkTagChange(info.tag, selectedNotes, this.postSelection));
        const updateWarning = () => {
            const value = cleanTagInput(input.value);
            warning.empty();
            warning.removeClass("is-error", "is-warning");
            if (!value)
                return;
            if (!isValidTag(value)) {
                warning.setText("Используйте буквы, цифры, `_`, `-` и `/`.");
                warning.addClass("is-error");
                return;
            }
            warning.removeClass("is-error");
            const target = this.plugin.getTagInfo(value);
            if (target && tagKey(value, this.plugin.settings.caseSensitive) !== info.key) {
                warning.setText(`#${value} уже существует. Теги будут объединены.`);
                warning.addClass("is-warning");
            }
        };
        input.addEventListener("input", () => {
            this.renameDraft.value = input.value;
            updateWarning();
        });
        updateWarning();
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                addButton.click();
            }
        });
        addButton.addEventListener("click", () => {
            const target = cleanTagInput(input.value);
            if (this.plugin.addOrUpdateChange(info.tag, target, selectedNotes, this.postSelection)) {
                this.selectedTag = info.tag;
                this.renameDraft.value = "";
                this.render();
            }
        });
        this.renderYearStats(card, info);
        const previewHeader = card.createDiv({ cls: "tra-preview-header" });
        const previewTitle = previewHeader.createDiv({ cls: "tra-preview-title" });
        setIcon(previewTitle.createSpan({ cls: "tra-preview-icon" }), "files");
        previewTitle.createEl("span", { text: "В заметках" });
        previewHeader.createSpan({ cls: "tra-note-selection-count" });
        const selectionBar = card.createDiv({ cls: "tra-note-selection-bar" });
        const selectAll = selectionBar.createEl("button", { cls: "tra-secondary-button tra-note-select-all", attr: { type: "button" } });
        setIcon(selectAll.createSpan({ cls: "tra-button-icon" }), "check-check");
        selectAll.createSpan({ text: "Выбрать все" });
        const selectNone = selectionBar.createEl("button", { cls: "tra-secondary-button tra-note-select-none", attr: { type: "button" } });
        setIcon(selectNone.createSpan({ cls: "tra-button-icon" }), "circle-x");
        selectNone.createSpan({ text: "Снять все" });
        selectionBar.createSpan({ cls: "tra-note-selection-hint", text: "Шапка карточки — выбрать заметку, текст — открыть её." });
        selectAll.addEventListener("click", () => {
            for (const file of info.files)
                selectedNotes.add(file.path);
            this.syncNoteSelectionUI(info);
        });
        selectNone.addEventListener("click", () => {
            selectedNotes.clear();
            this.syncNoteSelectionUI(info);
        });
        const previews = card.createDiv({ cls: "tra-preview-list" });
        this.renderPreviews(previews, info);
        this.syncNoteSelectionUI(info);
    }
    /**
     * Notes of the selected tag that queued operations will change. Defaults to
     * all notes (or the scope of an already queued change for this tag); notes
     * tagged later are selected automatically, vanished ones are dropped.
     */
    getNoteSelection(info) {
        const current = new Set(info.files.map((file) => file.path));
        const pending = this.plugin.pendingChanges.get(info.key) ?? this.plugin.pendingAdditions.get(info.key);
        // Start over for a new tag, and after the queued change for this tag was
        // applied or removed (otherwise "0 of N" would linger after applying).
        if (!this.noteSelection || this.noteSelection.key !== info.key || (this.noteSelection.hadPending && !pending)) {
            const paths = Array.isArray(pending?.paths) ? new Set(pending.paths.filter((path) => current.has(path))) : new Set(current);
            this.noteSelection = { key: info.key, paths, known: current, hadPending: Boolean(pending) };
            // Chosen records belong to this tag's selection (restored from a queued change).
            this.postSelection = new Map(Object.entries(pending?.posts ?? {}).filter(([path]) => current.has(path)));
            return paths;
        }
        this.noteSelection.hadPending = Boolean(pending);
        const { paths, known } = this.noteSelection;
        for (const path of current) {
            if (!known.has(path))
                paths.add(path);
        }
        for (const path of [...paths]) {
            if (!current.has(path))
                paths.delete(path);
        }
        this.noteSelection.known = current;
        return paths;
    }
    toggleNoteSelection(info, path) {
        const paths = this.getNoteSelection(info);
        if (paths.has(path))
            paths.delete(path);
        else
            paths.add(path);
        this.syncNoteSelectionUI(info);
    }
    syncNoteSelectionUI(info) {
        const root = this.contentEl;
        const paths = this.getNoteSelection(info);
        const total = info.files.length;
        const selected = paths.size;
        root.querySelector(".tra-note-selection-count")?.setText(`Выбрано ${selected} из ${total}`);
        const selectAll = root.querySelector(".tra-note-select-all");
        if (selectAll)
            selectAll.disabled = selected === total;
        const selectNone = root.querySelector(".tra-note-select-none");
        if (selectNone)
            selectNone.disabled = selected === 0;
        const hint = root.querySelector(".tra-scope-hint");
        if (hint) {
            hint.setText(selected === total
                ? `Действия применятся ко всем ${total} ${pluralRu(total, "заметке", "заметкам", "заметкам")} с тегом.`
                : `Действия применятся только к отмеченным заметкам: ${selected} из ${total}.`);
            hint.classList.toggle("is-partial", selected !== total);
        }
        for (const card of Array.from(root.querySelectorAll(".tra-file-card[data-path]"))) {
            const isSelected = paths.has(card.getAttribute("data-path"));
            updatePostBadge(card, isSelected ? this.postSelection.get(card.getAttribute("data-path")) : null);
            card.classList.toggle("is-excluded", !isSelected);
            const checkbox = card.querySelector(".tra-file-check");
            if (checkbox)
                checkbox.checked = isSelected;
        }
    }
    /**
     * Notes with the tag per year (by the current date source). A click on a year
     * opens "Заметки по датам" filtered to that year and tag.
     */
    renderYearStats(card, info) {
        const counts = new Map();
        let undated = 0;
        for (const file of info.files) {
            const time = this.getNoteCreationTimestamp(file);
            if (!time) {
                undated += 1;
                continue;
            }
            const year = new Date(time).getUTCFullYear();
            counts.set(year, (counts.get(year) ?? 0) + 1);
        }
        const section = card.createDiv({ cls: "tra-year-stats" });
        const header = section.createDiv({ cls: "tra-year-header" });
        const title = header.createDiv({ cls: "tra-preview-title" });
        setIcon(title.createSpan({ cls: "tra-preview-icon" }), "bar-chart-3");
        title.createSpan({ text: "По годам" });
        header.createSpan({ cls: "tra-year-source", text: this.plugin.describeDateSource() });
        if (counts.size === 0) {
            section.createDiv({ cls: "tra-year-empty", text: "Ни у одной заметки с тегом нет даты в выбранном источнике." });
            return;
        }
        const years = [...counts.keys()].sort((a, b) => a - b);
        const first = years[0];
        const last = years[years.length - 1];
        // Show empty years inside the range too, unless the range is huge (e.g. a stray 1970).
        const range = last - first <= 40 ? Array.from({ length: last - first + 1 }, (_, i) => first + i) : years;
        const max = Math.max(...counts.values());
        const labelStep = range.length > 24 ? Math.ceil(range.length / 12) : 1;
        const chart = section.createDiv({ cls: "tra-year-chart", attr: { role: "list" } });
        range.forEach((year, index) => {
            const count = counts.get(year) ?? 0;
            const bar = chart.createEl("button", {
                cls: `tra-year-bar${count === 0 ? " is-empty" : ""}`,
                attr: {
                    type: "button",
                    role: "listitem",
                    title: count ? `${year}: ${count} ${pluralRu(count, "заметка", "заметки", "заметок")} — открыть в «Заметках по датам»` : `${year}: нет заметок`,
                    "aria-label": `${year}: ${count}`,
                },
            });
            bar.disabled = count === 0;
            bar.createSpan({ cls: "tra-year-count", text: count ? String(count) : "" });
            const track = bar.createSpan({ cls: "tra-year-track" });
            const fill = track.createSpan({ cls: "tra-year-fill" });
            fill.style.height = `${count ? Math.max(6, Math.round((count / max) * 100)) : 0}%`;
            bar.createSpan({ cls: "tra-year-label", text: index % labelStep === 0 || index === range.length - 1 ? String(year) : "" });
            bar.addEventListener("click", () => this.openYearInBulk(year, info.tag));
        });
        if (undated > 0)
            section.createDiv({ cls: "tra-year-empty", text: `Без даты: ${undated} ${pluralRu(undated, "заметка", "заметки", "заметок")}.` });
    }
    openYearInBulk(year, tag) {
        this.bulkDateFrom = `${year}-01-01`;
        this.bulkDateTo = `${year}-12-31`;
        this.bulkTagMode = "all";
        this.bulkIncludeTags.splice(0, this.bulkIncludeTags.length, tag);
        this.bulkExcludeTags.splice(0, this.bulkExcludeTags.length);
        this.bulkFolder = "";
        this.bulkTextQuery = "";
        this.bulkTextMatches = null;
        this.bulkFilterApplied = true;
        this.bulkSelectedPaths.clear();
        this.bulkPostSelection.clear();
        this.bulkVisibleFiles = [];
        this.bulkRenderLimit = BULK_PAGE_SIZE;
        this.activePage = "bulk";
        this.render();
        this.contentEl.scrollTop = 0;
    }
    openNotePreview(file, highlightTag, selection, info = null) {
        const posts = info ? {
            get: () => this.postSelection.get(file.path) ?? null,
            set: (value) => {
                if (value)
                    this.postSelection.set(file.path, value);
                else
                    this.postSelection.delete(file.path);
                this.syncNoteSelectionUI(info);
            },
        } : undefined;
        new NotePreviewModal(this.plugin.app, file, { plugin: this.plugin, highlightTag, selection, posts }).open();
    }
    renderPreviews(parent, info) {
        const files = info.files;
        const limit = this.showAllPreviews ? files.length : Math.min(files.length, PREVIEW_PAGE_SIZE);
        for (const file of files.slice(0, limit)) {
            const item = parent.createDiv({
                cls: "tra-file-card is-clickable",
                attr: { role: "button", tabindex: "0", "aria-label": `Просмотреть заметку ${file.basename}`, "data-path": file.path },
            });
            const selection = {
                isSelected: () => this.getNoteSelection(info).has(file.path),
                toggle: () => this.toggleNoteSelection(info, file.path),
            };
            const openPreview = () => this.openNotePreview(file, info.tag, selection, info);
            // Two click zones: the header (title, path) toggles the checkbox,
            // the text opens the note in a window.
            item.addEventListener("click", (event) => {
                const target = event.target instanceof Element ? event.target : null;
                // External links open in the browser; the checkbox handles itself.
                if (target?.closest("a.external-link, .tra-file-check"))
                    return;
                if (target?.closest(".tra-file-title-row, .tra-file-path"))
                    selection.toggle();
                else
                    openPreview();
            });
            item.addEventListener("keydown", (event) => {
                if (event.target !== item)
                    return;
                if (event.key === "Enter") {
                    event.preventDefault();
                    openPreview();
                }
                else if (event.key === " ") {
                    event.preventDefault();
                    selection.toggle();
                }
            });
            const titleRow = item.createDiv({ cls: "tra-file-title-row" });
            const checkbox = titleRow.createEl("input", { cls: "tra-file-check", attr: { type: "checkbox", title: "Изменять эту заметку", "aria-label": `Изменять заметку ${file.basename}` } });
            checkbox.addEventListener("click", (event) => event.stopPropagation());
            checkbox.addEventListener("change", () => {
                if (checkbox.checked !== selection.isSelected())
                    selection.toggle();
            });
            const docIcon = titleRow.createDiv({ cls: "tra-file-icon" });
            setIcon(docIcon, "file-text");
            const link = titleRow.createSpan({ cls: "tra-file-link", text: file.basename });
            link.setAttr("title", file.path);
            titleRow.createSpan({ cls: "tra-post-badge" });
            titleRow.setAttr("title", "Выбрать или снять выбор");
            const path = item.createDiv({ cls: "tra-file-path", text: file.path });
            // Keep the path available to screen readers even when the title is short.
            path.setAttr("aria-label", file.path);
            const excerptEl = item.createDiv({ cls: "tra-excerpt markdown-rendered", attr: { title: "Открыть заметку" } });
            this.renderWhenVisible(excerptEl, () => this.renderPreviewExcerpt(excerptEl, file, info.tag));
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
        else if (this.showAllPreviews && files.length > PREVIEW_PAGE_SIZE) {
            const less = parent.createEl("button", { cls: "tra-show-more", text: "Свернуть список", attr: { type: "button" } });
            less.addEventListener("click", () => {
                this.showAllPreviews = false;
                this.render();
            });
        }
    }
    async renderPreviewExcerpt(excerptEl, file, tag) {
        const component = this.renderComponent;
        try {
            const raw = await this.plugin.app.vault.cachedRead(file);
            // A newer render replaced this card while the file was being read.
            if (!excerptEl.isConnected || component !== this.renderComponent)
                return;
            const withoutFrontmatter = stripFrontmatter(raw);
            const caseSensitive = this.plugin.settings.caseSensitive;
            const tagIndex = findInlineTagIndex(withoutFrontmatter, tag, caseSensitive);
            const plainIndex = tagIndex >= 0 ? tagIndex : findTextIndex(withoutFrontmatter, tag, caseSensitive);
            const maxChars = this.plugin.settings.previewChars;
            const start = plainIndex >= 0 ? Math.max(0, plainIndex - Math.floor(maxChars * 0.28)) : 0;
            const excerpt = withoutFrontmatter.slice(start, start + maxChars);
            const renderedExcerpt = `${start > 0 ? "…\n\n" : ""}${excerpt}${start + maxChars < withoutFrontmatter.length ? "\n\n…" : ""}`;
            // Render the snippet with Obsidian's Markdown engine, so headings,
            // lists, emphasis, links, tables, and other Markdown syntax appear as layout.
            await MarkdownRenderer.render(this.plugin.app, renderedExcerpt, excerptEl, file.path, component);
            this.highlightRenderedTag(excerptEl, tag);
        }
        catch {
            if (excerptEl.isConnected) {
                excerptEl.empty();
                excerptEl.addClass("tra-muted");
                excerptEl.setText("Не удалось прочитать заметку.");
            }
        }
    }
    highlightRenderedTag(container, tag) {
        highlightTagInElement(container, tag, this.plugin.settings.caseSensitive);
    }
    renderPendingChanges(root) {
        const changes = this.plugin.getPendingChanges();
        const section = root.createDiv({ cls: "tra-queue-card" });
        const header = section.createDiv({ cls: "tra-queue-header" });
        const titleGroup = header.createDiv({ cls: "tra-queue-title-group" });
        const icon = titleGroup.createDiv({ cls: "tra-queue-icon" });
        setIcon(icon, "git-pull-request");
        const title = titleGroup.createDiv();
        title.createEl("h3", { text: "На изменение" });
        title.createEl("p", { text: "Проверьте список перед применением" });
        header.createSpan({ cls: "tra-queue-count", text: String(changes.length) });
        if (changes.length === 0) {
            const empty = section.createDiv({ cls: "tra-queue-empty" });
            empty.createEl("span", { text: "Очередь пока пуста" });
            empty.createEl("small", { text: "Выберите тег, чтобы переименовать, удалить, снять маркировку # или добавить связанные теги в заметки." });
            return;
        }
        const list = section.createDiv({ cls: "tra-queue-list" });
        for (const change of changes) {
            const row = list.createDiv({ cls: "tra-queue-row" });
            const mapping = row.createDiv({ cls: "tra-queue-mapping" });
            mapping.createDiv({ cls: "tra-queue-old", text: `#${change.oldTag}` });
            if (change.action === "add") {
                const addTarget = mapping.createDiv({ cls: "tra-queue-add" });
                setIcon(addTarget.createSpan(), "plus");
                addTarget.createSpan({ text: `Добавить ${change.addTags.map((tag) => `#${tag}`).join(" ")}` });
            }
            else if (change.action === "delete" || change.newTag === null) {
                const deleteTarget = mapping.createDiv({ cls: "tra-queue-delete" });
                setIcon(deleteTarget.createSpan(), "trash-2");
                deleteTarget.createSpan({ text: "Удалить тег" });
            }
            else if (change.action === "unmark") {
                const unmarkTarget = mapping.createDiv({ cls: "tra-queue-unmark" });
                setIcon(unmarkTarget.createSpan(), "hash");
                unmarkTarget.createSpan({ text: "Оставить # как текст" });
            }
            else {
                const arrow = mapping.createDiv({ cls: "tra-queue-arrow" });
                setIcon(arrow.createSpan(), "arrow-right");
                mapping.createDiv({ cls: "tra-queue-new", text: `#${change.newTag}` });
            }
            const info = this.plugin.getTagInfo(change.oldTag);
            const total = info?.files.length ?? 0;
            const scoped = Array.isArray(change.paths) ? this.plugin.filesForChange(change).length : null;
            const withPosts = change.posts ? Object.keys(change.posts).length : 0;
            row.createDiv({
                cls: `tra-queue-files${scoped !== null || withPosts ? " is-partial" : ""}`,
                attr: withPosts ? { title: `В ${withPosts} ${pluralRu(withPosts, "заметке", "заметках", "заметках")} изменятся только выбранные записи` } : {},
                text: scoped !== null
                    ? `${scoped} из ${total} ${pluralRu(total, "заметки", "заметок", "заметок")}`
                    : `${total} ${pluralRu(total, "заметка", "заметки", "заметок")}`,
            });
            const remove = row.createEl("button", { cls: "tra-remove-change", attr: { type: "button", title: "Убрать из очереди", "aria-label": `Убрать #${change.oldTag}` } });
            setIcon(remove, "x");
            remove.addEventListener("click", () => this.plugin.removeChange(change.oldTag, change.action));
        }
        const totalFiles = this.plugin.affectedFiles(changes).length;
        const footer = section.createDiv({ cls: "tra-queue-footer" });
        footer.createSpan({ cls: "tra-queue-total", text: `${totalFiles} ${pluralRu(totalFiles, "файл", "файла", "файлов")} затронуто` });
        const actions = section.createDiv({ cls: "tra-queue-actions" });
        const clear = actions.createEl("button", { cls: "tra-secondary-button", text: "Очистить" });
        clear.type = "button";
        clear.addEventListener("click", () => this.plugin.clearChanges());
        const apply = actions.createEl("button", { cls: "tra-primary-button tra-apply-button" });
        apply.type = "button";
        const applyIcon = apply.createSpan({ cls: "tra-button-icon" });
        setIcon(applyIcon, "check-check");
        apply.createSpan({ text: "Применить" });
        apply.addEventListener("click", () => {
            const mergedTargets = this.plugin.existingMergeTargets(changes);
            const files = this.plugin.affectedFiles(changes);
            new ApplyConfirmModal(this.plugin.app, this.plugin, changes, files, mergedTargets, (selectedPaths) => this.plugin.applyQueuedChanges(selectedPaths)).open();
        });
    }
}

module.exports = { AuditPageMixin };
