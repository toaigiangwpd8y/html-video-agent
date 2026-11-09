export type AppRegistration = {
  id: string;
  name: string;
  url: string;
  workspaceRelativePath: string;
  sourceAliases?: Record<string, string>;
};

export type AppRegistry = { version: 1; apps: AppRegistration[] };
