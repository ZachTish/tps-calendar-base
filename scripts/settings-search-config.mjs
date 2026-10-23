export const ROUTES = {
  "rules": "Rules & creation",
  "sources": "Calendar sources",
  "view": "View & navigation",
  "appearance": "Appearance",
  "advanced": "Advanced"
};
export const SOURCES = {
  "src/settings-tab.ts": {
    "methods": {
      "renderExternalCalendars": "sources",
      "renderStyleRuleManager": "appearance",
      "renderTimelineDatePairs": "view",
      "renderBaseQueryGuide": "rules",
      "renderGuideExample": "rules"
    },
    "containers": {
      "rulesPage": "rules",
      "sourcesPage": "sources",
      "viewPage": "view",
      "appearancePage": "appearance",
      "advancedPage": "advanced",
      "linkDetails": "advanced"
    },
    "objects": {
      "keys": {
        "label": "name",
        "suffix": " Key",
        "route": "advanced"
      }
    },
    "helpers": {
      "field": {
        "name": 0,
        "desc": 2
      },
      "createSettingsGroup": {
        "name": 1,
        "desc": 2
      }
    }
  }
};
export const EXTRA_ENTRIES = [];
