import * as vscode from 'vscode';
import AdvisorProvider from './advisor/services/advisorProvider';
import { AdvisorService } from './advisor/services/advisorService';
import { IExtension } from './base/modules/interfaces';
import SnykLib from './base/modules/snykLib';
import { AuthenticationService } from './base/services/authenticationService';
import { EmptyTreeDataProvider } from './base/views/emptyTreeDataProvider';
import { FeaturesViewProvider } from './base/views/featureSelection/featuresViewProvider';
import { SupportProvider } from './base/views/supportProvider';
import { StaticCliApi } from './cli/api/staticCliApi';
import { CliDownloadService } from './cli/services/cliDownloadService';
import { Iteratively } from './common/analytics/itly';
import { CommandController } from './common/commands/commandController';
import { OpenIssueCommandArg, ReportFalsePositiveCommandArg } from './common/commands/types';
import { configuration } from './common/configuration/instance';
import { SnykConfiguration } from './common/configuration/snykConfiguration';
import {
  SNYK_COPY_AUTH_LINK_COMMAND,
  SNYK_DCIGNORE_COMMAND,
  SNYK_ENABLE_CODE_COMMAND,
  SNYK_IGNORE_ISSUE_COMMAND,
  SNYK_LOGIN_COMMAND,
  SNYK_LOGOUT_COMMAND,
  SNYK_OPEN_BROWSER_COMMAND,
  SNYK_OPEN_ISSUE_COMMAND,
  SNYK_OPEN_LOCAL_COMMAND,
  SNYK_REPORT_FALSE_POSITIVE_COMMAND,
  SNYK_SETMODE_COMMAND,
  SNYK_SETTINGS_COMMAND,
  SNYK_SET_TOKEN_COMMAND,
  SNYK_SHOW_OUTPUT_COMMAND,
  SNYK_START_COMMAND,
} from './common/constants/commands';
import { MEMENTO_FIRST_INSTALL_DATE_KEY } from './common/constants/globalState';
import {
  SNYK_VIEW_ANALYSIS_CODE_ENABLEMENT,
  SNYK_VIEW_ANALYSIS_CODE_QUALITY,
  SNYK_VIEW_ANALYSIS_CODE_SECURITY,
  SNYK_VIEW_ANALYSIS_OSS,
  SNYK_VIEW_FEATURES,
  SNYK_VIEW_SUPPORT,
  SNYK_VIEW_WELCOME,
} from './common/constants/views';
import { ErrorHandler } from './common/error/errorHandler';
import { ErrorReporter } from './common/error/errorReporter';
import { ExperimentService } from './common/experiment/services/experimentService';
import { Logger } from './common/logger/logger';
import { NotificationService } from './common/services/notificationService';
import { User } from './common/user';
import { CodeActionKindAdapter } from './common/vscode/codeAction';
import { vsCodeComands } from './common/vscode/commands';
import { vsCodeEnv } from './common/vscode/env';
import { extensionContext } from './common/vscode/extensionContext';
import { HoverAdapter } from './common/vscode/hover';
import { vsCodeLanguages, VSCodeLanguages } from './common/vscode/languages';
import { MarkdownStringAdapter } from './common/vscode/markdownString';
import SecretStorageAdapter from './common/vscode/secretStorage';
import { ThemeColorAdapter } from './common/vscode/theme';
import { Range, Uri } from './common/vscode/types';
import { UriAdapter } from './common/vscode/uri';
import { vsCodeWindow } from './common/vscode/window';
import { vsCodeWorkspace } from './common/vscode/workspace';
import ConfigurationWatcher from './common/watchers/configurationWatcher';
import { IgnoreCommand } from './snykCode/codeActions/ignoreCommand';
import { SnykCodeService } from './snykCode/codeService';
import { CodeQualityIssueTreeProvider } from './snykCode/views/qualityIssueTreeProvider';
import { CodeSecurityIssueTreeProvider } from './snykCode/views/securityIssueTreeProvider';
import { NpmTestApi } from './snykOss/api/npmTestApi';
import { EditorDecorator } from './snykOss/editor/editorDecorator';
import { OssService } from './snykOss/services/ossService';
import { NpmModuleInfoFetchService } from './snykOss/services/vulnerabilityCount/npmModuleInfoFetchService';
import { OssVulnerabilityCountService } from './snykOss/services/vulnerabilityCount/ossVulnerabilityCountService';
import { ModuleVulnerabilityCountProvider } from './snykOss/services/vulnerabilityCount/vulnerabilityCountProvider';
import { OssVulnerabilityTreeProvider } from './snykOss/views/ossVulnerabilityTreeProvider';
import { OssSuggestionWebviewProvider } from './snykOss/views/suggestion/ossSuggestionWebviewProvider';
import { DailyScanJob } from './snykOss/watchers/dailyScanJob';

class SnykExtension extends SnykLib implements IExtension {
  public async activate(vscodeContext: vscode.ExtensionContext): Promise<void> {
    extensionContext.setContext(vscodeContext);
    this.context = extensionContext;

    const snykConfiguration = await this.getSnykConfiguration();
    if (snykConfiguration) {
      await ErrorReporter.init(configuration, snykConfiguration, extensionContext.extensionPath, vsCodeEnv, Logger);
    }

    try {
      await this.initializeExtension(vscodeContext, snykConfiguration);
    } catch (e) {
      ErrorHandler.handle(e, Logger);
    }
  }

  private async getSnykConfiguration(): Promise<SnykConfiguration | undefined> {
    try {
      const snykConfiguration = await SnykConfiguration.get(
        extensionContext.extensionPath,
        configuration.isDevelopment,
      );

      return snykConfiguration;
    } catch (e) {
      ErrorHandler.handle(e, Logger);
    }
  }

  private async initializeExtension(vscodeContext: vscode.ExtensionContext, snykConfiguration?: SnykConfiguration) {
    this.user = await User.getAnonymous(this.context);

    this.analytics = new Iteratively(
      this.user,
      Logger,
      configuration.shouldReportEvents,
      configuration.isDevelopment,
      snykConfiguration,
    );

    SecretStorageAdapter.init(vscodeContext);

    this.configurationWatcher = new ConfigurationWatcher(this.analytics, Logger);
    this.notificationService = new NotificationService(
      vsCodeWindow,
      vsCodeComands,
      configuration,
      this.analytics,
      Logger,
    );

    this.statusBarItem.show();

    this.authService = new AuthenticationService(
      this.contextService,
      this.openerService,
      this,
      configuration,
      vsCodeWindow,
      this.analytics,
      Logger,
      this.snykCodeErrorHandler,
    );

    this.snykCode = new SnykCodeService(
      this.context,
      configuration,
      this.viewManagerService,
      vsCodeWorkspace,
      vsCodeWindow,
      this.user,
      this.falsePositiveApi,
      Logger,
      this.analytics,
      new VSCodeLanguages(),
      this.snykCodeErrorHandler,
      new UriAdapter(),
      this.codeSettings,
    );

    this.advisorService = new AdvisorProvider(this.advisorApiClient, Logger);
    this.cliDownloadService = new CliDownloadService(
      this.context,
      new StaticCliApi(vsCodeWorkspace),
      vsCodeWindow,
      Logger,
    );
    this.ossService = new OssService(
      this.context,
      Logger,
      configuration,
      new OssSuggestionWebviewProvider(this.context, vsCodeWindow, Logger),
      vsCodeWorkspace,
      this.viewManagerService,
      this.cliDownloadService,
      new DailyScanJob(this),
      this.notificationService,
      this.analytics,
    );

    this.commandController = new CommandController(
      this.openerService,
      this.authService,
      this.snykCode,
      this.ossService,
      this.scanModeService,
      vsCodeWorkspace,
      Logger,
      this.analytics,
    );
    this.registerCommands(vscodeContext);

    const codeSecurityIssueProvider = new CodeSecurityIssueTreeProvider(
        this.viewManagerService,
        this.contextService,
        this.snykCode,
        configuration,
      ),
      codeQualityIssueProvider = new CodeQualityIssueTreeProvider(
        this.viewManagerService,
        this.contextService,
        this.snykCode,
        configuration,
      );

    const ossVulnerabilityProvider = new OssVulnerabilityTreeProvider(
      this.viewManagerService,
      this.contextService,
      this.ossService,
      configuration,
    );

    const featuresViewProvider = new FeaturesViewProvider(vscodeContext.extensionUri, this.contextService);

    vscodeContext.subscriptions.push(
      vscode.window.registerWebviewViewProvider(SNYK_VIEW_FEATURES, featuresViewProvider),
      vscode.window.registerTreeDataProvider(SNYK_VIEW_ANALYSIS_OSS, ossVulnerabilityProvider),
      vscode.window.registerTreeDataProvider(SNYK_VIEW_ANALYSIS_CODE_SECURITY, codeSecurityIssueProvider),
      vscode.window.registerTreeDataProvider(SNYK_VIEW_ANALYSIS_CODE_QUALITY, codeQualityIssueProvider),
      vscode.window.registerTreeDataProvider(SNYK_VIEW_SUPPORT, new SupportProvider()),
    );

    const welcomeTree = vscode.window.createTreeView(SNYK_VIEW_WELCOME, {
      treeDataProvider: new EmptyTreeDataProvider(),
    });
    const codeEnablementTree = vscode.window.createTreeView(SNYK_VIEW_ANALYSIS_CODE_ENABLEMENT, {
      treeDataProvider: new EmptyTreeDataProvider(),
    });

    const ossTree = vscode.window.createTreeView(SNYK_VIEW_ANALYSIS_OSS, {
      treeDataProvider: ossVulnerabilityProvider,
    });
    const codeSecurityTree = vscode.window.createTreeView(SNYK_VIEW_ANALYSIS_CODE_SECURITY, {
      treeDataProvider: codeSecurityIssueProvider,
    });
    const codeQualityTree = vscode.window.createTreeView(SNYK_VIEW_ANALYSIS_CODE_QUALITY, {
      treeDataProvider: codeQualityIssueProvider,
    });
    vscodeContext.subscriptions.push(
      ossTree.onDidChangeVisibility(e => this.onDidChangeOssTreeVisibility(e.visible)),
      codeSecurityTree,
      codeQualityTree,
      welcomeTree.onDidChangeVisibility(e => this.onDidChangeWelcomeViewVisibility(e.visible)),
      codeEnablementTree,
    );

    // Fill the view container to expose views for tests
    const viewContainer = this.viewManagerService.viewContainer;
    viewContainer.set(SNYK_VIEW_WELCOME, welcomeTree);
    viewContainer.set(SNYK_VIEW_FEATURES, featuresViewProvider);

    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      this.runScan(false);
    });

    this.editorsWatcher.activate(this);
    this.configurationWatcher.activate(this);
    this.snykCode.activateWebviewProviders();
    this.ossService.activateSuggestionProvider();
    this.ossService.activateManifestFileWatcher(this);

    void this.notificationService.init();

    this.checkAdvancedMode().catch(err => ErrorReporter.capture(err));

    this.analytics.load();
    this.experimentService = new ExperimentService(this.user, Logger, configuration, snykConfiguration);
    this.experimentService.load();

    this.logPluginIsInstalled();

    this.initCliDownload();

    const npmModuleInfoFetchService = new NpmModuleInfoFetchService(
      configuration,
      Logger,
      new NpmTestApi(Logger, vsCodeWorkspace),
    );
    this.ossVulnerabilityCountService = new OssVulnerabilityCountService(
      vsCodeWorkspace,
      vsCodeWindow,
      vsCodeLanguages,
      new ModuleVulnerabilityCountProvider(this.ossService, npmModuleInfoFetchService),
      this.ossService,
      Logger,
      new EditorDecorator(vsCodeWindow, vsCodeLanguages, new ThemeColorAdapter()),
      new CodeActionKindAdapter(),
      this.analytics,
    );
    this.ossVulnerabilityCountService.activate();

    this.advisorScoreDisposable = new AdvisorService(
      vsCodeWindow,
      vsCodeLanguages,
      this.advisorService,
      Logger,
      vsCodeWorkspace,
      this.advisorApiClient,
      new ThemeColorAdapter(),
      new HoverAdapter(),
      new MarkdownStringAdapter(),
      configuration,
    );
    void this.advisorScoreDisposable.activate();

    // Actually start analysis
    this.runScan();
  }

  public async deactivate(): Promise<void> {
    this.snykCode.dispose();
    this.ossVulnerabilityCountService.dispose();
    await this.analytics.flush();
    await ErrorReporter.flush();
  }

  private logPluginIsInstalled(): void {
    // Use memento until lifecycle hooks are implemented
    // https://github.com/microsoft/vscode/issues/98732
    if (!this.context.getGlobalStateValue(MEMENTO_FIRST_INSTALL_DATE_KEY)) {
      this.analytics.logPluginIsInstalled();
      void this.context.updateGlobalStateValue(MEMENTO_FIRST_INSTALL_DATE_KEY, Date.now());
    }
  }

  private initCliDownload(): CliDownloadService {
    this.cliDownloadService.downloadOrUpdateCli().catch(err => {
      this.ossService?.handleCliDownloadFailure(err);
    });

    return this.cliDownloadService;
  }

  private registerCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand(SNYK_OPEN_BROWSER_COMMAND, (url: string) =>
        this.commandController.openBrowser(url),
      ),
      vscode.commands.registerCommand(SNYK_COPY_AUTH_LINK_COMMAND, () => this.commandController.copyAuthLink()),
      vscode.commands.registerCommand(SNYK_OPEN_LOCAL_COMMAND, (path: Uri, range?: Range | undefined) =>
        this.commandController.openLocal(path, range),
      ),
      vscode.commands.registerCommand(SNYK_LOGIN_COMMAND, () => this.commandController.initiateLogin()),
      vscode.commands.registerCommand(SNYK_SET_TOKEN_COMMAND, () => this.commandController.setToken()),
      vscode.commands.registerCommand(SNYK_LOGOUT_COMMAND, () => this.commandController.initiateLogout()),
      vscode.commands.registerCommand(SNYK_ENABLE_CODE_COMMAND, () =>
        this.commandController.executeCommand(SNYK_ENABLE_CODE_COMMAND, () => this.enableCode()),
      ),
      vscode.commands.registerCommand(SNYK_START_COMMAND, () =>
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        this.commandController.executeCommand(SNYK_START_COMMAND, () => this.runScan(true)),
      ),
      vscode.commands.registerCommand(SNYK_SETMODE_COMMAND, (mode: string) => this.commandController.setScanMode(mode)),
      vscode.commands.registerCommand(SNYK_SETTINGS_COMMAND, () => this.commandController.openSettings()),
      vscode.commands.registerCommand(SNYK_DCIGNORE_COMMAND, (custom: boolean, path?: string) =>
        this.commandController.createDCIgnore(custom, path),
      ),
      vscode.commands.registerCommand(SNYK_OPEN_ISSUE_COMMAND, (arg: OpenIssueCommandArg) =>
        this.commandController.openIssueCommand(arg),
      ),
      vscode.commands.registerCommand(SNYK_REPORT_FALSE_POSITIVE_COMMAND, (arg: ReportFalsePositiveCommandArg) =>
        this.commandController.reportFalsePositive(arg),
      ),
      vscode.commands.registerCommand(SNYK_SHOW_OUTPUT_COMMAND, () => this.commandController.showOutputChannel()),
      vscode.commands.registerCommand(SNYK_IGNORE_ISSUE_COMMAND, IgnoreCommand.ignoreIssues),
    );
  }
}

export default SnykExtension;
