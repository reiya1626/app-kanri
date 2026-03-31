// === Basic marks & sources ===
export type IssueMark = "<!>" | "<?>" | "<+>";
export type SourceTag = "user" | "auto";

export type Scenario = {
  id: string;
  classProblemText: string;
  objectProblemText: string;
  problemText: string;
  status: "draft" | "published";
  createdAt: string;
  updatedAt: string;
  title?: string;
};

// === Object & Attribute ===
export type Attr = {
  key: string;
  value: string;
  mark?: IssueMark;
  source?: SourceTag;
};

export type Obj = {
  id: string;
  name: string;
  type?: string;
  attrs?: Attr[];
  source?: string;
};

export type Link = {
  from: string;
  to: string;
  label?: string;
};

// === Logging ===
export type LogEvent = {
  ts: string;
  seq: number;
  session_id: string;
  problem_id?: string;
  user_id?: string;
  event: string;
  payload?: Record<string, any>;
  tz_offset?: number;
};

// === Snapshot ===
export type Snapshot = {
  objects: Obj[];
  links: Link[];
};

// === Class clustering ===
export type ClassCluster = {
  className: string;
  name?: string;
  instances: string[];
  confirmed?: boolean;
};

// === Class attribute ===
export type ClassAttr = {
  className: string;
  name: string;
  type: "string" | "int" | "real" | "bool";
  unit?: string;
  isId?: boolean;
};

// === Relation ===
export type Relation = {
  a: string;
  b: string;
  name?: string;
  roleA?: string;
  roleB?: string;
};

// === Association class ===
export type AssocClass = {
  name: string;
  between: [string, string];
  attrs: ClassAttr[];
};

// === Multiplicity ===
export type Multiplicity = {
  a: string;
  b: string;
  multA: "0..1" | "1" | "0..*" | "1..*";
  multB: "0..1" | "1" | "0..*" | "1..*";
  name?: string;
};

// === Inheritance ===
export type Inheritance = {
  parent: string;
  child: string;
};

// === Edges ===
export type Edge = {
  id: string;
  from: string;
  to: string;
  label?: string;
  source?: SourceTag;
};

// === Snapshot input ===
export type SnapshotInput = {
  id: string;
  name: string;
  objects: Obj[];
  links: Edge[];
};

// === Compare suggestions ===
export type RelationSuggestion = {
  from: string;
  to: string;
  label?: string;
  count: number;
};

export type MultiplicityHint = {
  key: string;
  from: string;
  to: string;
  perSnapshot: Array<{
    snapshotId: string;
    fromToCounts: number[];
    toFromCounts: number[];
  }>;
};

// === Wizard ===
export type WizardClass = {
  className: string;
  instances: string[];
  enabled: boolean;
};

export type WizardRelation = {
  from: string;
  to: string;
  enabled: boolean;
  label?: string;
  roleFrom?: string;
  roleTo?: string;
  multFrom?: string;
  multTo?: string;
};

export type WizardClassAttr = {
  className: string;
  name: string;
  type: "string" | "number" | "boolean" | "unknown";
  required: boolean;
  isId: boolean;
};

export type WizardInheritance = {
  parent: string;
  child: string;
  enabled: boolean;
};

export type WizardState = {
  classes: WizardClass[];
  relations: WizardRelation[];
  classAttrs?: WizardClassAttr[];
  inheritances?: WizardInheritance[];
};

// === Step3: Attribute suggestions ===
export type AttrCandidate = {
  name: string;
  inferredType: "string" | "number" | "boolean" | "unknown";
  requiredByInstances: number;
  totalInstances: number;
};

export type AttrSuggestions = {
  className: string;
  candidates: AttrCandidate[];
}[];

// === Promote ===
export type PromoteItem = {
  parent: string;
  name: string;
  type: "string" | "number" | "boolean" | "unknown";
  children: string[];
  requiredAll: boolean;
  presentInParent: boolean;
};

// === Learner attempt ===
export type LearnerAttempt = {
  id: string;
  scenarioId: string;
  snapshot: Snapshot;
  objectDiagramUrl?: string;
  classDiagramUrl?: string;
  submittedAt: string;
};