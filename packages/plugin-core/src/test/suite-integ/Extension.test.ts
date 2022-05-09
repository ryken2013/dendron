import {
  ConfigUtils,
  InstallStatus,
  IntermediateDendronConfig,
  Time,
} from "@dendronhq/common-all";
import {
  DConfig,
  DEPRECATED_PATHS,
  EngineUtils,
  getWSMetaFilePath,
  LocalConfigScope,
  MetadataService,
} from "@dendronhq/engine-server";
import { VAULTS } from "@dendronhq/engine-test-utils";
import * as mocha from "mocha";
import { describe } from "mocha";
import sinon from "sinon";
import { ExtensionProvider } from "../../ExtensionProvider";
import { StartupUtils } from "../../utils/StartupUtils";
import { expect } from "../testUtilsv2";
import { describeMultiWS } from "../testUtilsV3";

async function inactiveMessageTest(opts: {
  done: mocha.Done;
  firstInstall?: number;
  firstWsInitialize?: number;
  inactiveUserMsgStatus?: "submitted" | "cancelled";
  inactiveUserMsgSendTime?: number;
  workspaceActivated?: boolean;
  firstLookupTime?: number;
  lastLookupTime?: number;
  shouldDisplayMessage: boolean;
}) {
  const {
    done,
    firstInstall,
    firstWsInitialize,
    inactiveUserMsgStatus,
    inactiveUserMsgSendTime,
    shouldDisplayMessage,
    firstLookupTime,
    lastLookupTime,
    workspaceActivated,
  } = opts;
  const svc = MetadataService.instance();
  svc.setMeta("firstInstall", firstInstall);
  svc.setMeta("firstWsInitialize", firstWsInitialize);
  svc.setMeta("inactiveUserMsgStatus", inactiveUserMsgStatus);
  svc.setMeta("inactiveUserMsgSendTime", inactiveUserMsgSendTime);
  svc.setMeta("dendronWorkspaceActivated", workspaceActivated);
  svc.setMeta("firstLookupTime", firstLookupTime);
  svc.setMeta("lastLookupTime", lastLookupTime);
  const expected = StartupUtils.shouldDisplayInactiveUserSurvey();
  expect(expected).toEqual(shouldDisplayMessage);
  sinon.restore();
  done();
}

function getDefaultConfig() {
  const defaultConfig: IntermediateDendronConfig = {
    ...ConfigUtils.genDefaultConfig(),
  };
  defaultConfig.workspace.vaults = VAULTS.MULTI_VAULT_WITH_THREE_VAULTS();
  return defaultConfig;
}

suite("GIVEN local config", () => {
  describe("AND WHEN workspace config is present", () => {
    const configScope: LocalConfigScope = LocalConfigScope.WORKSPACE;
    const defaultConfig = getDefaultConfig();
    const localVaults = [{ fsPath: "vault-local" }];

  let ctx: ExtensionContext;
  beforeEach(async () => {
    ctx = VSCodeUtils.getOrCreateMockContext();
    // Required for StateService Singleton Init at the moment.
    // eslint-disable-next-line no-new
    new StateService({
      globalState: ctx.globalState,
      workspaceState: ctx.workspaceState,
    });
    await resetCodeWorkspace();
    homeDirStub = TestEngineUtils.mockHomeDir();
    userConfigDirStub = mockUserConfigDir();
    wsFoldersStub = stubWSFolders(undefined);
  });
  afterEach(() => {
    homeDirStub.restore();
    userConfigDirStub.restore();
    wsFoldersStub.restore();
  });
  const opts = {
    noSetInstallStatus: true,
  };

  // TODO: This test case fails in Windows if the logic in setupBeforeAfter (stubs) is not there. Look into why that is the case
  describeMultiWS("WHEN command is gathering inputs", opts, () => {
    let showOpenDialog: sinon.SinonStub;

    beforeEach(async () => {
      const cmd = new SetupWorkspaceCommand();
      showOpenDialog = sinon.stub(window, "showOpenDialog");
      await cmd.gatherInputs();
    });
    afterEach(() => {
      showOpenDialog.restore();
    });

    test("THEN file picker is opened", (done) => {
      expect(showOpenDialog.calledOnce).toBeTruthy();
      done();
    });
  });

  describe("WHEN initializing a CODE workspace", function () {
    this.timeout(6 * 1000);

    describe("AND workspace has not been set up yet", () => {
      test("THEN Dendon does not activate", async () => {
        const resp = await _activate(ctx);
        expect(resp).toBeFalsy();
        const dendronState = MetadataService.instance().getMeta();
        expect(isNotUndefined(dendronState.firstInstall)).toBeTruthy();
        expect(isNotUndefined(dendronState.firstWsInitialize)).toBeFalsy();
      });
    });

    describe("AND a new workspace is being created", () => {
      test("THEN Dendron creates the workspace correctly", async () => {
        const wsRoot = tmpDir().name;

        MetadataService.instance().setActivationContext(
          WorkspaceActivationContext.normal
        );

        const active = await _activate(ctx);
        // Not active yet, because there is no workspace
        expect(active).toBeFalsy();
        stubSetupWorkspace({
          wsRoot,
        });
        const cmd = new SetupWorkspaceCommand();
        await cmd.execute({
          rootDirRaw: wsRoot,
          skipOpenWs: true,
          skipConfirmation: true,
          workspaceInitializer: new BlankInitializer(),
          selfContained: false,
        });
        const resp = await readYAMLAsync(path.join(wsRoot, "dendron.yml"));
        expect(resp).toEqual({
          version: 5,
          dev: {
            enablePreviewV2: true,
          },
          commands: {
            lookup: {
              note: {
                selectionMode: "extract",
                confirmVaultOnCreate: true,
                vaultSelectionModeOnCreate: "smart",
                leaveTrace: false,
                bubbleUpCreateNew: true,
                fuzzThreshold: 0.2,
              },
            },
            randomNote: {},
            copyNoteLink: {},
            insertNote: {
              initialValue: "templates",
            },
            insertNoteLink: {
              aliasMode: "none",
              enableMultiSelect: false,
            },
            insertNoteIndex: {
              enableMarker: false,
            },
          },
          workspace: {
            vaults: [
              {
                fsPath: "vault",
              },
            ],
            journal: {
              dailyDomain: "daily",
              name: "journal",
              dateFormat: "y.MM.dd",
              addBehavior: "childOfDomain",
            },
            scratch: {
              name: "scratch",
              dateFormat: "y.MM.dd.HHmmss",
              addBehavior: "asOwnDomain",
            },
            task: {
              name: "task",
              dateFormat: "y.MM.dd",
              addBehavior: "asOwnDomain",
              statusSymbols: {
                "": " ",
                wip: "w",
                done: "x",
                assigned: "a",
                moved: "m",
                blocked: "b",
                delegated: "l",
                dropped: "d",
                pending: "y",
              },
              prioritySymbols: {
                H: "high",
                M: "medium",
                L: "low",
              },
              todoIntegration: false,
              createTaskSelectionType: "selection2link",
            },
            graph: {
              zoomSpeed: 1,
            },
            enableAutoCreateOnDefinition: false,
            enableXVaultWikiLink: false,
            enableRemoteVaultInit: true,
            enableUserTags: true,
            enableHashTags: true,
            workspaceVaultSyncMode: "noCommit",
            enableAutoFoldFrontmatter: false,
            enableEditorDecorations: true,
            maxPreviewsCached: 10,
            maxNoteLength: 204800,
            enableFullHierarchyNoteTitle: false,
          },
          preview: {
            enableFMTitle: true,
            enableNoteTitleForLink: true,
            enableFrontmatterTags: true,
            enableHashesForFMTags: false,
            enableMermaid: true,
            enablePrettyRefs: true,
            enableKatex: true,
            automaticallyShowPreview: false,
          },
          publishing: {
            enableFMTitle: true,
            enableFrontmatterTags: true,
            enableHashesForFMTags: false,
            enableKatex: true,
            enableMermaid: true,
            enableNoteTitleForLink: true,
            copyAssets: true,
            enablePrettyRefs: true,
            siteHierarchies: ["root"],
            writeStubs: false,
            siteRootDir: "docs",
            seo: {
              title: "Dendron",
              description: "Personal Knowledge Space",
            },
            github: {
              enableEditLink: true,
              editLinkText: "Edit this page on GitHub",
              editBranch: "main",
              editViewMode: "tree",
            },
            enableSiteLastModified: true,
            enableRandomlyColoredTags: true,
            enablePrettyLinks: true,
            duplicateNoteBehavior: {
              action: "useVault",
              payload: ["vault"],
            },
          },
        });

        const dendronState = MetadataService.instance().getMeta();
        expect(isNotUndefined(dendronState.firstInstall)).toBeTruthy();
        expect(isNotUndefined(dendronState.firstWsInitialize)).toBeTruthy();
        expect(
          await fs.readdir(path.join(wsRoot, DEFAULT_LEGACY_VAULT_NAME))
        ).toEqual(genEmptyWSFiles());
      });
    });

    describe("AND a new workspace is being created with a template initializer", () => {
      test("setup with template initializer", async () => {
        const wsRoot = tmpDir().name;
        MetadataService.instance().setActivationContext(
          WorkspaceActivationContext.normal
        );
        const out = await _activate(ctx);
        // Not active yet, because there is no workspace
        expect(out).toBeFalsy();
        stubSetupWorkspace({
          wsRoot,
        });

        const cmd = new SetupWorkspaceCommand();
        await cmd.execute({
          rootDirRaw: wsRoot,
          skipOpenWs: true,
          skipConfirmation: true,
          workspaceInitializer: new TemplateInitializer(),
          selfContained: false,
        } as SetupWorkspaceOpts);

        const resp = await readYAMLAsync(path.join(wsRoot, "dendron.yml"));
        expect(resp).toContain({
          workspace: {
            vaults: [
              {
                fsPath: "templates",
                name: "dendron.templates",
                seed: "dendron.templates",
              },
              {
                fsPath: "vault",
              },
            ],
            seeds: {
              "dendron.templates": {},
            },
          },
        });
        const dendronState = MetadataService.instance().getMeta();
        expect(isNotUndefined(dendronState.firstInstall)).toBeTruthy();
        expect(isNotUndefined(dendronState.firstWsInitialize)).toBeTruthy();
        expect(
          await fs.readdir(path.join(wsRoot, DEFAULT_LEGACY_VAULT_NAME))
        ).toEqual(genEmptyWSFiles());
      });
    });

    describeMultiWS(
      "AND given additional vaults in local config",
      {
        preActivateHook: async ({ wsRoot }) => {
          await DConfig.writeLocalConfig({
            wsRoot,
            config: { workspace: { vaults: localVaults } },
            configScope,
          });
        },
      },
      () => {
        test("THEN engine should load with extra workspace", () => {
          const ext = ExtensionProvider.getExtension();
          const _defaultConfig = getDefaultConfig();
          _defaultConfig.workspace.vaults = localVaults.concat(
            defaultConfig.workspace.vaults
          );
          const config = ext.getDWorkspace().config;
          expect(config).toEqual(_defaultConfig);
        });
      }
    );
  });
});

// These tests run on Windows too actually, but fail on the CI. Skipping for now.

describe("shouldDisplayInactiveUserSurvey", () => {
  const ONE_WEEK = 604800;
  const NOW = Time.now().toSeconds();
  const ONE_WEEK_BEFORE = NOW - ONE_WEEK;
  const TWO_WEEKS_BEFORE = NOW - 2 * ONE_WEEK;
  const THREE_WEEKS_BEFORE = NOW - 3 * ONE_WEEK;
  const FOUR_WEEKS_BEFORE = NOW - 4 * ONE_WEEK;
  const FIVE_WEEKS_BEFORE = NOW - 5 * ONE_WEEK;
  const SIX_WEEKS_BEFORE = NOW - 6 * ONE_WEEK;
  const SEVEN_WEEKS_BEFORE = NOW - 7 * ONE_WEEK;
  describe("GIVEN not prompted yet", () => {
    describe("WHEN is first week active user AND inactive for less than four weeks", () => {
      test("THEN should not display inactive user survey", (done) => {
        inactiveMessageTest({
          done,
          firstInstall: THREE_WEEKS_BEFORE,
          firstWsInitialize: THREE_WEEKS_BEFORE,
          firstLookupTime: THREE_WEEKS_BEFORE,
          lastLookupTime: THREE_WEEKS_BEFORE,
          workspaceActivated: true,
          shouldDisplayMessage: false,
        });
      });
    });
    describe("WHEN is first week active user AND inactive for at least four weeks", () => {
      test("THEN should display inactive user survey", (done) => {
        inactiveMessageTest({
          done,
          firstInstall: FIVE_WEEKS_BEFORE,
          firstWsInitialize: FIVE_WEEKS_BEFORE,
          firstLookupTime: FIVE_WEEKS_BEFORE,
          lastLookupTime: FOUR_WEEKS_BEFORE,
          workspaceActivated: true,
          shouldDisplayMessage: true,
        });
      });
    });
  });
  describe("GIVEN already prompted", () => {
    describe("WHEN user has submitted", () => {
      test("THEN should never display inactive user survey", (done) => {
        inactiveMessageTest({
          done,
          firstInstall: FIVE_WEEKS_BEFORE,
          firstWsInitialize: FIVE_WEEKS_BEFORE,
          firstLookupTime: FIVE_WEEKS_BEFORE,
          lastLookupTime: FOUR_WEEKS_BEFORE,
          inactiveUserMsgSendTime: TWO_WEEKS_BEFORE,
          workspaceActivated: true,
          inactiveUserMsgStatus: "submitted",
          shouldDisplayMessage: false,
        });
      });
    });
    describe("WHEN it has been another four weeks since user rejected survey", () => {
      test("THEN should display inactive user survey if inactive", (done) => {
        inactiveMessageTest({
          done,
          firstInstall: SEVEN_WEEKS_BEFORE,
          firstWsInitialize: SEVEN_WEEKS_BEFORE,
          firstLookupTime: SEVEN_WEEKS_BEFORE,
          lastLookupTime: SIX_WEEKS_BEFORE,
          inactiveUserMsgSendTime: FOUR_WEEKS_BEFORE,
          workspaceActivated: true,
          inactiveUserMsgStatus: "cancelled",
          shouldDisplayMessage: true,
        });
      });
      test("THEN should not display inactive user survey if active", (done) => {
        inactiveMessageTest({
          done,
          firstInstall: SEVEN_WEEKS_BEFORE,
          firstWsInitialize: SEVEN_WEEKS_BEFORE,
          firstLookupTime: SEVEN_WEEKS_BEFORE,
          lastLookupTime: ONE_WEEK_BEFORE,
          inactiveUserMsgSendTime: FOUR_WEEKS_BEFORE,
          workspaceActivated: true,
          inactiveUserMsgStatus: "cancelled",
          shouldDisplayMessage: false,
        });
      });
    });
    describe("WHEN it hasn't been another four weeks since rejected prompt", () => {
      test("THEN should not display inactive user survey", (done) => {
        inactiveMessageTest({
          done,
          firstInstall: SEVEN_WEEKS_BEFORE,
          firstWsInitialize: SEVEN_WEEKS_BEFORE,
          firstLookupTime: SEVEN_WEEKS_BEFORE,
          lastLookupTime: SIX_WEEKS_BEFORE,
          inactiveUserMsgSendTime: THREE_WEEKS_BEFORE,
          workspaceActivated: true,
          inactiveUserMsgStatus: "cancelled",
          shouldDisplayMessage: false,
        });
      });
    });
  });
});

suite("missing default config detection", () => {
  describeMultiWS(
    "GIVEN dendron.yml with missing default key",
    {
      modConfigCb: (config) => {
        // @ts-ignore
        delete config.workspace.workspaceVaultSyncMode;
        return config;
      },
      timeout: 1e5,
    },
    () => {
      test("THEN missing defaults are detected", () => {
        const ws = ExtensionProvider.getDWorkspace();
        const config = DConfig.getRaw(ws.wsRoot);
        expect(config.workspace?.workspaceVaultSyncMode).toEqual(undefined);
        const out = ConfigUtils.detectMissingDefaults({ config });
        expect(out.needsBackfill).toBeTruthy();
        expect(
          out.backfilledConfig.workspace.workspaceVaultSyncMode
        ).toBeTruthy();
      });
    }
  );

  describe("GIVEN upgraded", () => {
    describeMultiWS(
      "AND missing default key",
      {
        modConfigCb: (config) => {
          // @ts-ignore
          delete config.workspace.workspaceVaultSyncMode;
          return config;
        },
      },
      () => {
        test("THEN prompted to add missing defaults", () => {
          const ext = ExtensionProvider.getExtension();
          const out = StartupUtils.shouldDisplayMissingDefaultConfigMessage({
            ext,
            extensionInstallStatus: InstallStatus.UPGRADED,
          });
          expect(out).toBeTruthy();
        });
      }
    );

    describeMultiWS("AND not missing default key", {}, () => {
      test("THEN not prompted to add missing defaults", () => {
        const ext = ExtensionProvider.getExtension();
        const out = StartupUtils.shouldDisplayMissingDefaultConfigMessage({
          ext,
          extensionInstallStatus: InstallStatus.UPGRADED,
        });
        expect(out).toBeFalsy();
      });
    });
  });

  describe("GIVEN not upgraded", () => {
    describeMultiWS(
      "AND missing default key",
      {
        modConfigCb: (config) => {
          // @ts-ignore
          delete config.workspace.workspaceVaultSyncMode;
          return config;
        },
      },
      () => {
        test("THEN not prompted to add missing defaults", () => {
          const ext = ExtensionProvider.getExtension();
          [InstallStatus.NO_CHANGE, InstallStatus.INITIAL_INSTALL].forEach(
            (extensionInstallStatus) => {
              const out = StartupUtils.shouldDisplayMissingDefaultConfigMessage(
                {
                  ext,
                  extensionInstallStatus,
                }
              );
              expect(out).toBeFalsy();
            }
          );
        });
      }
    );

    describeMultiWS("AND not missing default key", {}, () => {
      test("THEN not prompted to add missing defaults", () => {
        const ext = ExtensionProvider.getExtension();
        [InstallStatus.NO_CHANGE, InstallStatus.INITIAL_INSTALL].forEach(
          (extensionInstallStatus) => {
            const out = StartupUtils.shouldDisplayMissingDefaultConfigMessage({
              ext,
              extensionInstallStatus,
            });
            expect(out).toBeFalsy();
          }
        );
      });
    });
  });
});

suite("deprecated config detection", () => {
  describeMultiWS(
    "GIVEN dendron.yml with deprecated key",
    {
      modConfigCb: (config) => {
        // @ts-ignore
        config.dev = { enableWebUI: true };
        return config;
      },
      timeout: 1e5,
    },
    () => {
      test("THEN deprecated key is detected", () => {
        const ws = ExtensionProvider.getDWorkspace();
        const config = DConfig.getRaw(ws.wsRoot);
        expect((config.dev as any).enableWebUI).toBeTruthy();
        const out = ConfigUtils.detectDeprecatedConfigs({
          config,
          deprecatedPaths: DEPRECATED_PATHS,
        });
        expect(out).toEqual(["dev.enableWebUI"]);
      });
    }
  );

  describe("GIVEN upgraded", () => {
    describeMultiWS(
      "AND deprecated key exists",
      {
        modConfigCb: (config) => {
          // @ts-ignore
          config.dev = { enableWebUI: true };
          return config;
        },
        timeout: 1e5,
      },
      () => {
        test("THEN prompted to remove deprecated config", () => {
          const ext = ExtensionProvider.getExtension();
          const out = StartupUtils.shouldDisplayDeprecatedConfigMessage({
            ext,
            extensionInstallStatus: InstallStatus.UPGRADED,
          });
          expect(out).toBeTruthy();
        });
      }
    );

    describeMultiWS("AND deprecated key doesn't exist", {}, () => {
      test("THEN not prompted to remove deprecated config", () => {
        const ext = ExtensionProvider.getExtension();
        const out = StartupUtils.shouldDisplayDeprecatedConfigMessage({
          ext,
          extensionInstallStatus: InstallStatus.UPGRADED,
        });
        expect(out).toBeFalsy();
      });
    });
  });

  describe("GIVEN not upgraded", () => {
    describeMultiWS(
      "AND deprecated key exists",
      {
        modConfigCb: (config) => {
          // @ts-ignore
          config.dev = { enableWebUI: true };
          return config;
        },
        timeout: 1e5,
      },
      () => {
        test("THEN not prompted to remove deprecated config", () => {
          const ext = ExtensionProvider.getExtension();
          [InstallStatus.NO_CHANGE, InstallStatus.INITIAL_INSTALL].forEach(
            (extensionInstallStatus) => {
              const out = StartupUtils.shouldDisplayDeprecatedConfigMessage({
                ext,
                extensionInstallStatus,
              });
              expect(out).toBeFalsy();
            }
          );
        });
      }
    );

    describeMultiWS("AND deprecated key doesn't exist", {}, () => {
      test("THEN not prompted to remove deprecated config", () => {
        const ext = ExtensionProvider.getExtension();
        [InstallStatus.NO_CHANGE, InstallStatus.INITIAL_INSTALL].forEach(
          (extensionInstallStatus) => {
            const out = StartupUtils.shouldDisplayDeprecatedConfigMessage({
              ext,
              extensionInstallStatus,
            });
            expect(out).toBeFalsy();
          }
        );
      });
    });
  });
});
