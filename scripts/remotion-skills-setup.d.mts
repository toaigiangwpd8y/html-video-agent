export type SkillSource = {runtimeVersion:string;repo:string;revision:string};
export type SetupSpawnResult = {status:number|null;error?:Error};
export declare function assertRemotionFamily(rootDir:string,expectedVersion:string):void;
export declare function installOfficialSkills(rootDir:string,source:SkillSource,options?:{run?:(command:string,args:string[],options:Record<string,unknown>)=>SetupSpawnResult;platform?:string;env?:NodeJS.ProcessEnv}):void;
