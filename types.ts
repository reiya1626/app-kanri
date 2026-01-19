// === Basic marks & sources ===
export type IssueMark = "<!>" | "<?>" | "<+>";
export type SourceTag = "user" | "auto";


export type Scenario = {
  id: string;
  classProblemText: string;
  objectProblemText: string;
  problemText: string;
  // 追加
  status: "draft" | "published";
  createdAt: string;
  updatedAt: string;
  title?: string; // 任意
};

// === Object & Attribute (for snapshots) ===
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
  ts: string;                 // ISO8601 (UTC)
  seq: number;                // クライアント内の連番
  session_id: string;         // 匿名セッションID（UUID）
  problem_id?: string;        // 任意：問題ID
  user_id?: string;           // 任意：ユーザ識別子（無ければ省略）
  event: string;              // 例: "puml.import", "object.add", "convert.start"
  payload?: Record<string, any>; // イベント固有の少量データ
  tz_offset?: number;         // タイムゾーン（分）
};

// === Snapshot (object diagram input) ===
export type Snapshot = {
  objects: Obj[];
  links: Link[];
};

// === Class clustering (class candidates) ===
export type ClassCluster = {
  className: string;          // 例: "マンション物件"
  name?: string;
  instances: string[];        // 例: ["マンション物件M1","マンション物件M2"]
  confirmed?: boolean;        // 穴埋めで確定時に true
};

// === Class attribute (generalized) ===
export type ClassAttr = {
  className: string;          // 例: "物件"
  name: string;               // 例: "販売価格"
  type: "string" | "int" | "real" | "bool";
  unit?: string;
  isId?: boolean;
};

// === Relation (between classes) ===
export type Relation = {
  a: string;                  // 両端のクラス候補名
  b: string;
  name?: string;              // 例: "帰属"
  roleA?: string;
  roleB?: string;
};

// === Association class (value between A—B) ===
export type AssocClass = {
  name: string;               // 例: "注文明細"
  between: [string, string];  // ["注文","品目"]
  attrs: ClassAttr[];
};

// === Multiplicity (finalized later) ===
export type Multiplicity = {
  a: string;                  // 関係端A（クラス候補名）
  b: string;                  // 関係端B（クラス候補名）
  multA: "0..1" | "1" | "0..*" | "1..*";
  multB: "0..1" | "1" | "0..*" | "1..*";
  name?: string;
};

// === Inheritance (parent-child) ===
export type Inheritance = { parent: string; child: string };

// === Convert API (not the wizard one) ===
export type ConvertRequest = {
  snapshots: Snapshot[];            // フェーズ1では 2 枚を想定
  clusters?: ClassCluster[];        // 穴埋め途中をここに送る想定（フェーズ2以降）
  classAttrs?: ClassAttr[];
  relations?: Relation[];
  assocClasses?: AssocClass[];
  multiplicities?: Multiplicity[];
  inheritance?: Inheritance[];
  decisionLog?: string[];           // 学習者の選択ログ
};

export type ConvertResponse = {
  declarationText: string;          // 人間可読の宣言文（フェーズ1は簡易でOK）
  plantuml: string;                 // 生成されたPlantUML（フェーズ1は暫定でOK）
  warnings: string[];
  // 初期提案（オレンジ）— フェーズ1は最低限：クラスタ＆関係＆多重度ヒント
  suggestions?: {
    clusters?: ClassCluster[];
    relations?: Relation[];
    multiplicityHints?: {
      // スナップショット毎の接続数（観測値）を返して多重度検討の材料にする
      key: string;  // "A--B"
      counts: { snapshotId: string; aToB: number[]; bToA: number[] }[];
    }[];
  };
};

// === Edges (links for snapshots) ===
export type Edge = {
  id: string;
  from: string;      // オブジェクト名（例: "マンション物件M1"）
  to: string;        // オブジェクト名（例: "棟A"）
  label?: string;    // リンク名（例: "帰属"）
  source?: SourceTag;
};

// === Snapshot input with links (front-end to API) ===
export type SnapshotInput = {
  id: string;        // "S1" | "S2" など
  name: string;      // "状況①" など
  objects: Obj[];    // 既存の Obj を再利用
  links: Edge[];     // 穴埋め入力
};

// === Object diagram PUML API response ===
export type ObjectPumlResponse = {
  puml: string;      // 生成した PlantUML テキスト
  encoded: string;   // plantuml-encoder で encode した文字列
  urlSvg: string;    // SVGプレビューURL（PlantUML公開サーバ）
};

// === Compare suggestions ===
export type RelationSuggestion = {
  from: string;               // クラスタ名（例: "マンション物件"）
  to: string;                 // クラスタ名（例: "棟"）
  label?: string;             // 最頻リンク名（例: "帰属"）
  count: number;              // 2枚合算の出現回数
};

export type MultiplicityHint = {
  key: string;                // "マンション物件--棟" のようなキー
  from: string;               // 例: "マンション物件"
  to: string;                 // 例: "棟"
  perSnapshot: Array<{
    snapshotId: string;       // "S1" / "S2"
    fromToCounts: number[];   // 各 from インスタンスが持つ to へのリンク本数
    toFromCounts: number[];   // 逆方向
  }>;
};

export type CompareRequest = { snapshots: SnapshotInput[] };

export type CompareResponse = {
  suggestions: {
    clusters: ClassCluster[];
    relations: RelationSuggestion[];
    multiplicityHints: MultiplicityHint[];
  };
};

// === Wizard (UI state) ===
export type WizardClass = {
  className: string;
  instances: string[];
  enabled: boolean;
};

export type WizardRelation = {
  from: string;
  to: string;
  enabled: boolean;
  label?: string;     // 提案の最頻ラベル（初期値）
  roleFrom?: string;  // 役割名（from側）
  roleTo?: string;    // 役割名（to側）
  multFrom?: string;  // 多重度（from側） 例: "1", "0..1", "0..*", "1..*"
  multTo?: string;    // 多重度（to側）
};

// Step3: 属性確定
export type WizardClassAttr = {
  className: string;
  name: string;
  type: "string" | "number" | "boolean" | "unknown";
  required: boolean;
  isId: boolean;
};

// Step4: 継承（一般化/特化）
export type WizardInheritance = {
  parent: string;
  child: string;
  enabled: boolean;
};

// Wizard 全体（重複定義を排除し一本化）
export type WizardState = {
  classes: WizardClass[];
  relations: WizardRelation[];
  classAttrs?: WizardClassAttr[];      // Step3
  inheritances?: WizardInheritance[];  // Step4
};

// === Class diagram generation ===
export type ClassPumlRequest = { wizard: WizardState };
export type ClassPumlResponse = { puml: string; urlSvg: string };

// === Step3: Attribute suggestions ===
export type AttrCandidate = {
  name: string;                 // 例: "所在地", "販売価格", "部屋番号", "名称"
  inferredType: "string" | "number" | "boolean" | "unknown";
  requiredByInstances: number;  // そのクラスのインスタンスのうち、値がある個数
  totalInstances: number;       // そのクラスのインスタンス総数
};

export type AttrSuggestions = {
  className: string;
  candidates: AttrCandidate[];
}[];

export type AttrSuggestRequest = {
  snapshots: SnapshotInput[];          // S1/S2
  clusters: { className: string; instances: string[] }[]; // compare結果 or wizard.classes
};

export type AttrSuggestResponse = {
  suggestions: AttrSuggestions;
};

// 末尾あたりの適切な位置に追記（既存定義は触らない）
export type PromoteItem = {
  parent: string;   // 親クラス名
  name: string;     // 属性名（例: "所在地", "販売価格"）
  type: "string" | "number" | "boolean" | "unknown";
  children: string[];      // その属性を持っている子クラス
  requiredAll: boolean;    // 子側で全て必須なら true
  presentInParent: boolean; // 親が既に持っているか
};

export type LearnerAttempt = {
  id: string;                // 提出物のID（とりあえず Date.now().toString() とかでOK）
  scenarioId: string;        // どのシナリオに対する提出か
  snapshot: Snapshot;        // 学習者が作成した最終オブジェクト図
  objectDiagramUrl?: string; // そのときのオブジェクト図SVG (表示用)
  classDiagramUrl?: string;  // そのときのクラス図SVG (表示用)
  submittedAt: string;       // 提出時刻
};


export type AttrPromoteRequest = { wizard: WizardState };
export type AttrPromoteResponse = { suggestions: PromoteItem[] };
