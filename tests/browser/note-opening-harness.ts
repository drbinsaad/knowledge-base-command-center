import type { OpenViewState } from "obsidian";
import EntVaultCommandCenterPlugin, { KBCC_RETURN_NAVIGATION_STATE_KEY } from "../../src/main";
import type { EntVaultCommandCenterView } from "../../src/view";
import { TFile } from "./obsidian-browser";
import { app, plugin, view, store, deviceLocalValues, content } from "./view-harness";

const commandCenter = content;
if (!commandCenter) throw new Error("Synthetic command center is missing");

// The inspector renderer AND note-opening/return-route service are production
// code. Only the workspace is simulated: like Obsidian with background tabs,
// a new leaf is not active unless openFile explicitly requests activation.
// This is not native Obsidian or physical iPhone/Duo evidence.
const note = document.body.createEl("section", { attr: { "aria-label": "Synthetic note tab" } });
note.hidden = true;
let activePath: string | null = null;
let failOpening = false;
let openCount = 0;
let writes = 0;
const leafRequests: Array<string | boolean | undefined> = [];

Object.assign(app.vault, { configDir: ".obsidian" });
Object.assign(app.workspace, {
  getLeavesOfType: () => [],
  getLeaf: (kind?: string | boolean) => {
    leafRequests.push(kind);
    return {
      async openFile(file: TFile, state?: OpenViewState) {
        if (failOpening) throw new Error("Synthetic note open failed");
        openCount += 1;
        const activate = state?.active ?? kind !== "tab";
        if (!activate) return;
        activePath = file.path;
        commandCenter.hidden = true;
        note.hidden = false;
        note.empty();
        note.createEl("h1", { text: file.basename });
        const back = note.createEl("button", { text: "Return to command center", type: "button" });
        back.addEventListener("click", () => {
          // Host tab navigation: the command center is still present. Its saved
          // route is separately asserted below, not substituted with test state.
          note.hidden = true;
          commandCenter.hidden = false;
          activePath = null;
        });
        back.focus();
      },
    };
  },
});

const openingPlugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
openingPlugin.loadData = async () => structuredClone(store);
openingPlugin.saveData = async () => { writes += 1; };
plugin.openFile = async (file: TFile, source?: EntVaultCommandCenterView) => openingPlugin.openFile(file, source);

const api = {
  ready: false,
  failNextOpen(value: boolean) { failOpening = value; },
  state() {
    return {
      activePath, openCount, leafRequests, writes,
      route: structuredClone(deviceLocalValues.get(KBCC_RETURN_NAVIGATION_STATE_KEY)),
      selectedPath: plugin.data.selectedPath,
      query: view.captureReturnViewState().query,
    };
  },
};
export type NoteOpeningHarness = typeof api;
Object.assign(window, { kbccNoteOpening: api });
void openingPlugin.loadPluginData(false).then(() => { writes = 0; api.ready = true; });
