export interface PrivateSessionDescriptor {
  version:"1";
  handle:string;
  appId:string;
  contextId:string;
  role:string;
  sessionName:string;
  targetId:string;
  createdAt:string;
}

export interface ResolvedSession {descriptor:PrivateSessionDescriptor;endpoint:string;}

export type CaptureProgressState="starting"|"running"|"waiting_for_reauthentication"|"succeeded"|"failed";
export interface CaptureProgress {
  runId:string;
  stepId:string|null;
  state:CaptureProgressState;
  timestamp:string;
  errorCode?:string;
  appId?:string;
  contextId?:string;
}

export interface RegisterSessionInput {appId:string;contextId:string;sessionName:string;role?:string;}
