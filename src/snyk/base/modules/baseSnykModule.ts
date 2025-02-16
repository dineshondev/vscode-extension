import { AdvisorApiClient, IAdvisorApiClient } from '../../advisor/services/advisorApiClient';
import AdvisorProvider from '../../advisor/services/advisorProvider';
import { AdvisorService } from '../../advisor/services/advisorService';
import { CliDownloadService } from '../../cli/services/cliDownloadService';
import { IAnalytics } from '../../common/analytics/itly';
import { ISnykApiClient, SnykApiClient } from '../../common/api/apiСlient';
import { CommandController } from '../../common/commands/commandController';
import { configuration } from '../../common/configuration/instance';
import { ExperimentService } from '../../common/experiment/services/experimentService';
import { Logger } from '../../common/logger/logger';
import { ContextService, IContextService } from '../../common/services/contextService';
import { INotificationService } from '../../common/services/notificationService';
import { IOpenerService, OpenerService } from '../../common/services/openerService';
import { IViewManagerService, ViewManagerService } from '../../common/services/viewManagerService';
import { User } from '../../common/user';
import { ExtensionContext } from '../../common/vscode/extensionContext';
import { vsCodeWorkspace } from '../../common/vscode/workspace';
import { IWatcher } from '../../common/watchers/interfaces';
import { ISnykCodeService } from '../../snykCode/codeService';
import { CodeSettings, ICodeSettings } from '../../snykCode/codeSettings';
import { ISnykCodeErrorHandler, SnykCodeErrorHandler } from '../../snykCode/error/snykCodeErrorHandler';
import { FalsePositiveApi, IFalsePositiveApi } from '../../snykCode/falsePositive/api/falsePositiveApi';
import SnykEditorsWatcher from '../../snykCode/watchers/editorsWatcher';
import { OssService } from '../../snykOss/services/ossService';
import { OssVulnerabilityCountService } from '../../snykOss/services/vulnerabilityCount/ossVulnerabilityCountService';
import { IAuthenticationService } from '../services/authenticationService';
import { ScanModeService } from '../services/scanModeService';
import SnykStatusBarItem, { IStatusBarItem } from '../statusBarItem/statusBarItem';
import { ILoadingBadge, LoadingBadge } from '../views/loadingBadge';
import { IBaseSnykModule } from './interfaces';

export default abstract class BaseSnykModule implements IBaseSnykModule {
  context: ExtensionContext;

  readonly statusBarItem: IStatusBarItem;

  protected readonly editorsWatcher: IWatcher;
  protected configurationWatcher: IWatcher;

  readonly contextService: IContextService;
  readonly openerService: IOpenerService;
  readonly viewManagerService: IViewManagerService;
  protected authService: IAuthenticationService;
  protected cliDownloadService: CliDownloadService;
  protected ossService?: OssService;
  protected advisorService?: AdvisorProvider;
  protected commandController: CommandController;
  protected scanModeService: ScanModeService;
  protected ossVulnerabilityCountService: OssVulnerabilityCountService;
  protected advisorScoreDisposable: AdvisorService;

  protected notificationService: INotificationService;
  protected analytics: IAnalytics;

  protected snykApiClient: ISnykApiClient;
  protected advisorApiClient: IAdvisorApiClient;
  protected falsePositiveApi: IFalsePositiveApi;
  snykCode: ISnykCodeService;
  protected codeSettings: ICodeSettings;

  readonly loadingBadge: ILoadingBadge;
  protected user: User;
  protected experimentService: ExperimentService;
  protected snykCodeErrorHandler: ISnykCodeErrorHandler;

  constructor() {
    this.statusBarItem = new SnykStatusBarItem();
    this.editorsWatcher = new SnykEditorsWatcher();
    this.viewManagerService = new ViewManagerService();
    this.contextService = new ContextService();
    this.openerService = new OpenerService();
    this.scanModeService = new ScanModeService(this.contextService, configuration);
    this.loadingBadge = new LoadingBadge();
    this.snykApiClient = new SnykApiClient(configuration, vsCodeWorkspace, Logger);
    this.falsePositiveApi = new FalsePositiveApi(configuration, vsCodeWorkspace, Logger);
    this.snykCodeErrorHandler = new SnykCodeErrorHandler(
      this.contextService,
      this.loadingBadge,
      Logger,
      this,
      configuration,
    );
    this.codeSettings = new CodeSettings(this.snykApiClient, this.contextService, configuration, this.openerService);
    this.advisorApiClient = new AdvisorApiClient(configuration, Logger);
  }

  abstract runScan(): Promise<void>;
  abstract runCodeScan(): Promise<void>;
  abstract runOssScan(): Promise<void>;
}
