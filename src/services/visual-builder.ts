
import { App, Modal, Setting, setIcon, Notice } from "obsidian";
import { CalendarStyleRule, CalendarStyleCondition, CalendarField, CalendarOperator, CalendarStyleMatch } from "../types";

type StyleBuilderMode = "color" | "text" | "both";

export class CalendarStyleBuilderModal extends Modal {
    private rule: CalendarStyleRule;
    private onSave: (rule: CalendarStyleRule) => void;
    private container: HTMLElement;
    private mode: StyleBuilderMode;
    private activeTab: StyleBuilderMode;

    constructor(
        app: App,
        rule: CalendarStyleRule,
        onSave: (rule: CalendarStyleRule) => void,
        opts: { mode?: StyleBuilderMode } = {},
    ) {
        super(app);
        this.rule = JSON.parse(JSON.stringify(rule)); // Deep copy
        this.onSave = onSave;
        this.mode = opts.mode || "both";
        this.activeTab = this.mode === "text" ? "text" : "color";
    }

    onOpen() {
    this.modalEl.addClass("tps-keyboard-aware-modal");
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("calendar-style-builder-modal");

        // Add some basic CSS for the modal if not present
        this.addStyles();

        this.titleEl.setText(`Edit Rule: ${this.rule.label}`);

        this.container = contentEl.createDiv({ cls: "calendar-builder-container" });
        this.render();
    }

    private addStyles() {
        // Inject styling dynamically to ensure it matches the requested aesthetic
        const styleId = "calendar-builder-styles";
        if (!document.getElementById(styleId)) {
            const style = document.createElement("style");
            style.id = styleId;
            style.textContent = `
            .calendar-builder-container {
                display: flex;
                flex-direction: column;
                gap: 20px;
                padding-bottom: 20px;
            }
            .calendar-builder-section {
                border: 1px solid var(--background-modifier-border);
                border-radius: 8px;
                padding: 16px;
                background-color: var(--background-primary);
            }
            .calendar-builder-section-title {
                font-weight: 600;
                margin-bottom: 12px;
                color: var(--text-muted);
                text-transform: uppercase;
                font-size: 0.75em;
                letter-spacing: 0.05em;
            }
            .calendar-condition-row {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                align-items: center;
                margin-bottom: 8px;
                background: var(--background-secondary);
                padding: 8px;
                border-radius: 6px;
                border: 1px solid var(--background-modifier-border);
            }
            .calendar-condition-field-group {
                display: flex;
                flex: 1 1 190px;
                flex-wrap: wrap;
                gap: 8px;
                align-items: center;
                min-width: 0;
            }
            .calendar-condition-row select,
            .calendar-condition-row input {
                background-color: var(--background-primary);
                min-width: 0;
            }
            .calendar-condition-row > select {
                flex: 1 1 150px;
            }
            .calendar-condition-row > .condition-value {
                flex: 2 1 180px !important;
            }
            .calendar-condition-field-group > select,
            .calendar-condition-field-group > input {
                flex: 1 1 120px;
                width: auto !important;
            }
            .calendar-visual-preview {
                height: 40px;
                border-radius: 6px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: bold;
                margin-top: 10px;
                border: 1px solid var(--background-modifier-border);
            }
            .calendar-style-toggles {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
            }
            .calendar-style-tabs {
                display: flex;
                gap: 0;
                margin-bottom: 12px;
                border-bottom: 1px solid var(--background-modifier-border);
            }
            .calendar-style-tab {
                height: auto;
                padding: 8px 14px;
                border: 0;
                border-bottom: 2px solid transparent;
                border-radius: 0;
                background: transparent;
                color: var(--text-muted);
                font-weight: 500;
                box-shadow: none;
            }
            .calendar-style-tab.is-active,
            .calendar-style-tab[aria-pressed="true"] {
                border-bottom-color: var(--interactive-accent);
                color: var(--text-normal);
                font-weight: 600;
            }
            .calendar-style-btn {
                height: auto;
                padding: 6px 12px;
                border-radius: 4px;
                border: 1px solid var(--background-modifier-border);
                cursor: pointer;
                background: var(--background-primary);
                transition: all 0.2s ease;
            }
            .calendar-style-btn:hover {
                background: var(--background-modifier-hover);
            }
            .calendar-style-btn.is-active {
                background: var(--interactive-accent);
                color: var(--text-on-accent);
                border-color: var(--interactive-accent);
            }
            @media (max-width: 600px) {
                .calendar-builder-section {
                    padding: 12px;
                }
                .calendar-condition-row {
                    flex-direction: column;
                    align-items: stretch;
                }
                .calendar-condition-field-group {
                    width: 100%;
                    flex-direction: column;
                    align-items: stretch !important;
                }
                .calendar-condition-row select,
                .calendar-condition-row input {
                    width: 100% !important;
                    max-width: none;
                }
                .calendar-condition-row .explorer2-icon-button {
                    align-self: flex-end;
                }
            }
        `;
            document.head.appendChild(style);
        }
    }

    private render() {
        this.container.empty();

        // --- General Info Section ---
        const generalSection = this.container.createDiv({ cls: "calendar-builder-section" });
        generalSection.createDiv({ cls: "calendar-builder-section-title", text: "General" });

        new Setting(generalSection)
            .setName("Rule Label")
            .addText(text => text
                .setValue(this.rule.label)
                .setPlaceholder("e.g. High Priority")
                .onChange(v => {
                    this.rule.label = v;
                    this.titleEl.setText(`Edit Rule: ${v}`);
                }));

        new Setting(generalSection)
            .setName("Active")
            .addToggle(toggle => toggle
                .setValue(this.rule.active !== false)
                .onChange(v => this.rule.active = v));

        // --- Conditions Section ---
        const conditionsSection = this.container.createDiv({ cls: "calendar-builder-section" });
        conditionsSection.createDiv({ cls: "calendar-builder-section-title", text: "Conditions" });

        const logicRow = conditionsSection.createDiv({ cls: "calendar-condition-logic" });
        logicRow.style.marginBottom = "10px";
        logicRow.createSpan({ text: "Match " });
        const matchSelect = logicRow.createEl("select", { cls: "dropdown" });
        ["all", "any"].forEach(opt => {
            const o = matchSelect.createEl("option", { value: opt, text: opt });
            if (this.rule.match === opt) o.selected = true;
        });
        matchSelect.addEventListener("change", () => {
            this.rule.match = matchSelect.value as CalendarStyleMatch;
        });
        logicRow.createSpan({ text: " of the following:" });

        const conditionsList = conditionsSection.createDiv();
        this.renderConditions(conditionsList);

        const addBtn = conditionsSection.createEl("button", { text: "+ Add Condition", cls: "mod-cta" });
        addBtn.style.marginTop = "10px";
        addBtn.addEventListener("click", () => {
            this.rule.conditions.push({ field: "status", operator: "is", value: "" });
            this.renderConditions(conditionsList);
        });

        // --- Visuals Section ---
        const visualsSection = this.container.createDiv({ cls: "calendar-builder-section" });
        visualsSection.createDiv({ cls: "calendar-builder-section-title", text: "Visual Style" });

        const allowColor = this.mode !== "text";
        const allowText = this.mode !== "color";

        if (allowColor && allowText) {
            const tabContainer = visualsSection.createDiv({
                cls: "calendar-style-tabs",
                attr: {
                    role: "group",
                    "aria-label": "Style category",
                },
            });

            const tabs: { id: StyleBuilderMode; label: string }[] = [
                { id: "color", label: "Color" },
                { id: "text", label: "Text" },
            ];
            tabs.forEach((tab) => {
                const isActive = this.activeTab === tab.id;
                const tabEl = tabContainer.createEl("button", {
                    text: tab.label,
                    cls: `calendar-style-tab ${isActive ? "is-active" : ""}`,
                    attr: {
                        type: "button",
                        "aria-pressed": isActive ? "true" : "false",
                    },
                });
                tabEl.addEventListener("click", () => {
                    if (this.activeTab === tab.id) return;
                    this.activeTab = tab.id;
                    this.render();
                });
            });
        }

        const showColor = allowColor && this.activeTab === "color";
        const showText = allowText && this.activeTab === "text";

        if (showColor) {
            new Setting(visualsSection)
                .setName("Background Color")
                .addColorPicker(picker => picker
                    .setValue(this.rule.color || "#ffffff")
                    .onChange(v => {
                        this.rule.color = v;
                        this.updatePreview(previewBox);
                    }));
        } else if (!allowColor) {
            this.rule.color = "";
        }

        let currentStyles = new Set(
            (this.rule.textStyle || "")
                .split(",")
                .map(s => s.trim().toLowerCase())
                .filter(Boolean),
        );

        if (showText) {
            const styleContainer = visualsSection.createDiv();
            styleContainer.style.marginBottom = "15px";
            styleContainer.createDiv({ text: "Text Styles:", attr: { style: "margin-bottom: 8px; font-weight: 500;" } });

            const toggles = styleContainer.createDiv({ cls: "calendar-style-toggles" });
            const styles = [
                { id: "bold", label: "Bold" },
                { id: "italic", label: "Italic" },
                { id: "strikethrough", label: "Strike" },
                { id: "line-through", label: "Line-through" },
                { id: "underline", label: "Underline" }
            ];

            styles.forEach(s => {
                const isActive = currentStyles.has(s.id);
                const btn = toggles.createEl("button", {
                    cls: `calendar-style-btn ${isActive ? "is-active" : ""}`,
                    text: s.label,
                    attr: {
                        type: "button",
                        "aria-pressed": isActive ? "true" : "false",
                    },
                });
                btn.addEventListener("click", () => {
                    if (currentStyles.has(s.id)) currentStyles.delete(s.id);
                    else currentStyles.add(s.id);

                    this.rule.textStyle = Array.from(currentStyles).join(", ");
                    const isNowActive = currentStyles.has(s.id);
                    btn.classList.toggle("is-active", isNowActive);
                    btn.setAttr("aria-pressed", isNowActive ? "true" : "false");
                    this.updatePreview(previewBox);
                });
            });

            new Setting(visualsSection)
                .setName("Custom CSS Classes")
                .setDesc("Comma separated")
                .addText(text => text
                    .setValue(Array.from(currentStyles).filter(s => !styles.find(st => st.id === s)).join(", "))
                    .onChange(v => {
                        const customs = v.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
                        const presetIds = new Set(styles.map(s => s.id));
                        const newSet = new Set(Array.from(currentStyles).filter(s => presetIds.has(s)));
                        customs.forEach(c => newSet.add(c));
                        currentStyles.clear();
                        newSet.forEach(s => currentStyles.add(s));
                        this.rule.textStyle = Array.from(currentStyles).join(", ");
                        this.updatePreview(previewBox);
                    }));
        } else if (!allowText) {
            this.rule.textStyle = "";
        }

        // Live Preview
        visualsSection.createDiv({ text: "Preview:", attr: { style: "margin-top: 10px; font-weight: 500;" } });
        const previewBox = visualsSection.createDiv({ cls: "calendar-visual-preview", text: "Event Title" });
        this.updatePreview(previewBox);

        // --- Footer Buttons ---
        const footer = this.container.createDiv();
        footer.style.display = "flex";
        footer.style.justifyContent = "flex-end";
        footer.style.gap = "10px";
        footer.style.marginTop = "20px";

        const cancelBtn = footer.createEl("button", { text: "Cancel" });
        cancelBtn.addEventListener("click", () => this.close());

        const saveBtn = footer.createEl("button", { text: "Save Rule", cls: "mod-cta" });
        saveBtn.addEventListener("click", () => {
            // Ensure mode constraints before save
            if (this.mode === "color") this.rule.textStyle = "";
            if (this.mode === "text") this.rule.color = "";
            this.onSave(this.rule);
            this.close();
        });
    }

    private renderConditions(container: HTMLElement) {
        container.empty();
        this.rule.conditions.forEach((cond, idx) => {
            const row = container.createDiv({ cls: "calendar-condition-row" });

            // Field Wrapper
            const fieldContainer = row.createDiv({ cls: "calendar-condition-field-group" });

            // Field Select
            const fieldSelect = fieldContainer.createEl("select", { cls: "dropdown" });
            fieldSelect.setAttr("aria-label", `Condition ${idx + 1} field`);
            const isCustom = !["status", "priority"].includes(cond.field);

            ["status", "priority", "custom"].forEach(f => {
                const text = f === "custom" ? "Property" : f.charAt(0).toUpperCase() + f.slice(1);
                const opt = fieldSelect.createEl("option", { value: f, text: text });
                if (f === "custom" ? isCustom : cond.field === f) opt.selected = true;
            });

            fieldSelect.addEventListener("change", () => {
                const val = fieldSelect.value;
                if (val === "custom") {
                    if (["status", "priority"].includes(cond.field)) {
                        cond.field = ""; // Reset if switching from preset
                    }
                    this.renderConditions(container);
                } else {
                    cond.field = val as CalendarField;
                    this.renderConditions(container);
                }
            });

            // Custom Field Input
            if (isCustom) {
                const customInput = fieldContainer.createEl("input", { type: "text", cls: "condition-custom-field" });
                customInput.value = cond.field;
                customInput.placeholder = "Property name";
                customInput.setAttr("aria-label", `Condition ${idx + 1} property name`);
                customInput.addEventListener("change", () => {
                    cond.field = customInput.value;
                });
            }

            // Operator
            const operatorSelect = row.createEl("select", { cls: "dropdown" });
            operatorSelect.setAttr("aria-label", `Condition ${idx + 1} operator`);
            const ops: { v: CalendarOperator, l: string }[] = [
                { v: "is", l: "is" }, { v: "!is", l: "is not" },
                { v: "contains", l: "contains" }, { v: "!contains", l: "does not contain" },
                { v: "starts", l: "starts with" }, { v: "!starts", l: "does not start with" },
                { v: "ends", l: "ends with" }, { v: "!ends", l: "does not end with" },
                { v: "exists", l: "exists" }, { v: "!exists", l: "is missing" }
            ];
            ops.forEach(op => {
                const opt = operatorSelect.createEl("option", { value: op.v, text: op.l });
                if (cond.operator === op.v) opt.selected = true;
            });
            operatorSelect.addEventListener("change", () => {
                cond.operator = operatorSelect.value as CalendarOperator;
                this.renderConditions(container); // Re-render to update input state
            });

            // Value
            const valueInput = row.createEl("input", { type: "text", cls: "condition-value" });
            valueInput.value = cond.value || "";
            valueInput.placeholder = "Value";
            valueInput.setAttr("aria-label", `Condition ${idx + 1} value`);
            valueInput.disabled = ["exists", "!exists"].includes(cond.operator);
            valueInput.addEventListener("change", () => cond.value = valueInput.value);

            // Remove
            const removeBtn = row.createEl("button", {
                cls: "explorer2-icon-button",
                attr: {
                    type: "button",
                    "aria-label": `Remove condition ${idx + 1}`,
                },
            });
            removeBtn.innerHTML = "×";
            removeBtn.style.color = "var(--text-muted)";
            removeBtn.style.cursor = "pointer";
            removeBtn.style.border = "none";
            removeBtn.style.background = "transparent";
            removeBtn.style.fontSize = "18px";
            removeBtn.addEventListener("click", () => {
                this.rule.conditions.splice(idx, 1);
                this.renderConditions(container);
            });
        });
    }

    private updatePreview(el: HTMLElement) {
        el.style.backgroundColor = this.mode === "text" ? "var(--background-secondary)" : (this.rule.color || "var(--background-secondary)");
        el.style.color = "var(--text-normal)"; // Default text color unless implicit

        const styles = (this.mode === "color" ? "" : this.rule.textStyle || "").split(",").map(s => s.trim().toLowerCase());

        el.style.fontWeight = styles.includes("bold") ? "bold" : "normal";
        el.style.fontStyle = styles.includes("italic") ? "italic" : "normal";
        el.style.textDecoration = [
            styles.includes("strikethrough") || styles.includes("line-through") ? "line-through" : "",
            styles.includes("underline") ? "underline" : ""
        ].filter(Boolean).join(" ");

        if (styles.includes("faded")) el.style.opacity = "0.7";
        else el.style.opacity = "1";
    }
}
