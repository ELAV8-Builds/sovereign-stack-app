export interface Channel {
  id: string;
  name: string;
}

export interface SlackWizardProps {
  onComplete: () => void;
  onCancel?: () => void;
  embedded?: boolean; // true for onboarding, false for Settings
}

export interface StepNavigationProps {
  onBack: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
  nextLabel?: string;
  backLabel?: string;
  showCancel?: boolean;
  onCancel?: () => void;
}

export interface CreateAppStepProps {
  onNext: () => void;
  onCancel?: () => void;
}

export interface TokenInputStepProps {
  appToken: string;
  botToken: string;
  appTokenValid: boolean;
  botTokenValid: boolean;
  appTokenError: string;
  botTokenError: string;
  onAppTokenChange: (token: string) => void;
  onBotTokenChange: (token: string) => void;
  canProceed: boolean;
  onBack: () => void;
  onNext: () => void;
}

export interface TestConnectionStepProps {
  testing: boolean;
  testSuccess: boolean;
  testError: string;
  channels: Channel[];
  onTestConnection: () => void;
  onBack: () => void;
  onNext: () => void;
}

export interface RegisterChannelStepProps {
  channels: Channel[];
  selectedChannelId: string;
  groupName: string;
  triggerWord: string;
  groupNameError: string;
  registering: boolean;
  canCompleteSetup: boolean;
  onChannelSelect: (channelId: string) => void;
  onGroupNameChange: (name: string) => void;
  onTriggerWordChange: (word: string) => void;
  onCompleteSetup: () => void;
  onBack: () => void;
}
