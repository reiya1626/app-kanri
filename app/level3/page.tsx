// これはブラウザ上で，操作に応じた画面の更新や状態管理を行うために書かれるもの
"use client";

//reactのuseEffectとuseStateを使えるようにするためのおまじない
import React, { useEffect, useState } from "react";
//トップページで登録した問題文・正答PUMLを読めるようにしている
import { useProblemConfig } from "../../components/problem-config";

//型定義
type Attr = { key: string; value: string };
type Obj = { name: string; type?: string; attrs?: Attr[] };
type Link = { from: string; to: string; label?: string };
type Snapshot = { objects: Obj[]; links: Link[] };

export default function Level3Page() {
  //useProblemConfig でトップページで設定した問題文・正答PUMLを取得
  const {
    classProblemText,
    objectProblemText,
    classAnswerPuml,
    objectAnswerPuml,
  } = useProblemConfig();

  // 学習者が作っているODの現在内容を保持
  const [snapshot, setSnapshot] = useState<Snapshot>({ objects: [], links: [] });
  // APIから返ってくるPlantUML図のSVG　URLを保持
  const [objPumlUrl, setObjPumlUrl] = useState("");
  const [clsPumlUrl, setClsPumlUrl] = useState("");
  // APIエラー内容を保持
  const [objErr, setObjErr] = useState("");
  const [clsErr, setClsErr] = useState("");

  //まだ何も入力されていないかを調べる小さい関数
  const isEmptySnapshot = (s: Snapshot) =>
    (!s.objects || s.objects.length === 0) &&
    (!s.links || s.links.length === 0);

  // オブジェクト図プレビュー
  //snapshotが変わるたびに呼ばれる
  //何も無ければプレビューを空に
  //250msごとに/api/object-pumlにsnapshotを送る
  //正常ならurlSvgをobjPumlUelに保存→右側に画像として表示，失敗したらobjErrにメッセージを入れる
  //setTimeoutとclearTimeoutでタイプ中の無駄な連打を抑制(デバウンス)
  //useEffect→コンポーネントがレンダリングされたあとに，この副作用を実行するといった指示をReactに与えることが出来る
  useEffect(() => {
    if (isEmptySnapshot(snapshot)) {
      setObjPumlUrl("");
      setObjErr("");
      return;
    }
    const id = setTimeout(async () => {
      //try…catch文は、予想していない異常によりエラーが発生するような場面で意図的に回避するための処理
      //try{
          //例外エラーが発生するかもしれない処理
      //}catch(e){
        //例外エラーが起きたときに実行する処理
      //}

      try {
        //api/object-pumlに図のもととなるデータ(snapshot)を渡し，画像生成を要求
        //fetch(...)：サーバーと通信するための関数
        //method:"POST":データをサーバーに送信(作成・更新)するためのHTTPメソッドを指定してる
        //headers~:送信するデータ(body)がJSON形式であることをサーバーに伝えている
        //body~:図の元データであるsnapshotをJSON文字列に変換し，リクエストの本体として含めてる
        const res = await fetch("/api/object-puml", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snapshot }),
        });
        //サーバーからの応答(res)の本文(JSONデータ)を解析し，JSのオブジェクトjに格納する
        //.catch(()→({}))は応答の本文が空だったり，JSONとして不正だったりして解析に失敗した場合でも，
        //プログラムが停止しないように空のオブジェクト{}を返すための保険
        const j = await res.json().catch(() => ({}));
        //サーバー空の応答が成功したらif,そうでなければelseを実行
        //!res.ok→HTTPステータスコードが200でなければ(400とか)
        //setObjErr(...):エラーメッセージを表示するための状態を更新する
        // (応答メッセージがあればそれをなければステータスコードを返す)
        //setObjextPluntUml(""):古い図のURLをクリアする
        if (!res.ok) {
          setObjErr(j?.error || `HTTP ${res.status}`);
          setObjPumlUrl("");
        
        //成功なら，set~で取得した図の画像URLを保持するための状態を更新する
        } else {
          setObjPumlUrl(j?.urlSvg || "");
        }
      //tryブロック内で，ネット切断やサーバーが全く応答しなくなった時(例外)の処理
      //catch(e:any)でtryブロック内で発生したエラーをキャッチする
      } catch (e: any) {
        setObjErr(e?.message || "fetch error");
        setObjPumlUrl("");
      }
    }, 250);
    //snapshotが空になったとき，次のコードを実行する
    return () => clearTimeout(id);
  }, [snapshot]);

  // クラス図推定
  //useEffct(()→{:Reactのフック関数です。指定されたデータ（依存配列）が変わるたびに、中の関数を実行します。
  useEffect(() => {
    //snapshotに含まれるobjects(オブジェクトのリスト)の数が０であれば図を生成する必要がないので，次の処理へ
    if ((snapshot.objects?.length ?? 0) === 0) {
      setClsPumlUrl("");
      setClsErr("");
      return;
    }
    //デバウンス処理の開始．350ms後に，asyncで定義された非同期処理を実行するよう予約
    const id = setTimeout(async () => {
      //tryでエラー監視を開始．このブロック内でエラーがもし発生したらcatchに処理が移る
      try {
        const res = await fetch("/api/class-puml", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snapshot }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setClsErr(j?.error || `HTTP ${res.status}`);
          setClsPumlUrl("");
        } else {
          setClsPumlUrl(j?.urlSvg || "");
        }
      } catch (e: any) {
        setClsErr(e?.message || "fetch error");
        setClsPumlUrl("");
      }
    }, 350);
    return () => clearTimeout(id);
    //useEffectの依存配列→snapshotの値が変わるたびに，上の処理が実行される
  }, [snapshot]);

  //reactライブラリを用いてアプリのコンポーネントの表示部分を定義する
  //returnでreactコンポーネントが，webページに表示する内容(JSX/HTML構造)を返す
  //className="..."→HTML要素にCSSクラスを適用するための属性
  //クラス名を書き，その下に表示したいものを書く
  return (
    //メインコンテナ．ページ全体のコンテンツを囲むコンテナ
    //max-w-6xl:最大幅を設定，mx-auto:左右中央寄せ，p-6:内側の余白，space-y-6:子要素間の垂直スペース
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* 問題文表示（固定高さ＋スクロール） */}
      <section className="rounded-lg border bg-white p-2 space-y-2">
        <h1 className="text-xl font-semibold">
          レベル3：自力でのオブジェクト図整理をマスターしよう！
        </h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 1. クラス図作成問題（左側） */}
          <div>
            <div className="text-sm font-semibold mb-1">
              クラス図作成問題（本文）
            </div>
            <div className="text-sm bg-neutral-50 border rounded p-2 whitespace-pre-wrap max-h-40 overflow-y-auto">
              {classProblemText || "（トップページで問題文を設定してください）"}
            </div>
          </div>

          {/* 2. オブジェクト図作成問題（右側） */}
          <div>
            <div className="text-sm font-semibold mb-1">
              オブジェクト図作成問題（本文）
            </div>
            <div className="text-sm bg-neutral-50 border rounded p-2 whitespace-pre-wrap max-h-40 overflow-y-auto">
              {objectProblemText || "（トップページで問題文を設定してください）"}
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左：完全自力入力 UI */}
        <section className="rounded-lg border bg-white p-4 space-y-4">
          <h2 className="font-semibold text-sm">
            問題文からオブジェクト，スロット，リンクを自力で入力しよう！
          </h2>
          <ManualObjectsForm snapshot={snapshot} setSnapshot={setSnapshot} />
          <LinkMiniAdder snapshot={snapshot} setSnapshot={setSnapshot} />
        </section>

        {/* 右上：オブジェクト図プレビュー */}
        <section className="rounded-lg border bg-white">
          <div className="p-4 border-b flex items-center justify-between">
            <div className="font-semibold text-sm">
              オブジェクト図(リアルタイムプレビュー)
            </div>
            <button
              type="button"
              className="text-xs px-3 py-1 rounded border"
              //ボタンがクリックされたときに実行される処理
              onClick={() => {
                //snapshotが空でないかつ確認ダイアログでキャンセルを押したら，returnで処理を終了
                if (
                  !isEmptySnapshot(snapshot) &&
                  !confirm("入力内容とプレビューをクリアします。よろしいですか？")
                )
                  return;
                //snapshotを空にし，プレビューとエラーメッセージもクリア  
                setSnapshot({ objects: [], links: [] });
                setObjPumlUrl("");
                setObjErr("");
                setClsPumlUrl("");
                setClsErr("");
              }}
            >
              すべてクリア
            </button>
          </div>
          <div className="p-4">
            {objErr && (
              <div className="text-xs text-red-600 mb-2">
                API error: {objErr}
              </div>
            )}
            {objPumlUrl ? (
              //objectPumlUrlに格納されたURLを使って画像を表示
              <img alt="object-uml" src={objPumlUrl} />
            //objectPumlUrlが空の場合に以下を表示
            ) : (
              <div className="text-xs text-neutral-500">
                オブジェクト・スロット・リンクを入力すると図が表示されるよ
              </div>
            )}
          </div>
        </section>

        {/* 右下：推定クラス図（常に自動更新） */}
        <section className="rounded-lg border bg-white">
          <div className="p-4 border-b flex items-center justify-between">
            <div className="font-semibold text-sm">推定されるクラス図</div>
            <div className="text-[10px] text-neutral-500">
              上で入力したオブジェクト図から自動推定されたクラス図です。
            </div>
          </div>
          <div className="p-4">
            {clsErr && (
              <div className="text-xs text-red-600 mb-2">
                API error: {clsErr}
              </div>
            )}
            {clsPumlUrl ? (
              <img alt="class-uml" src={clsPumlUrl} />
            ) : (
              <div className="text-xs text-neutral-500">
                自分のオブジェクト図をもとにしたクラス図がここに表示されます。
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/** =========================
 * 手入力フォーム（Level3）
 * ========================= */
//ManualObjectsForm：オブジェクトとスロットを手動で入力・編集・削除するUIを提供するコンポーネント
function ManualObjectsForm({
  snapshot,
  setSnapshot,
}: {
  snapshot: Snapshot;
  setSnapshot: React.Dispatch<React.SetStateAction<Snapshot>>;
}) {
  //新しいオブジェクトを追加する関数の定義
  const addObject = () =>
    setSnapshot((prev) => ({
      ...prev,
      objects: [...prev.objects, { name: "", attrs: [] }],
    }));

  //指定されたインデックスのオブジェクト名を更新するための関数
  const updateName = (idx: number, name: string) =>
    setSnapshot((prev) => {
      const objects = [...prev.objects];
      objects[idx] = { ...objects[idx], name };
      return { ...prev, objects };
    });
  
    //指定されたインデックスのオブジェクトに新しいスロットを追加する関数
  const addAttrTo = (idx: number) =>
    setSnapshot((prev) => {
      const objects = [...prev.objects];
      const t = { ...(objects[idx] ?? { attrs: [] }) };
      t.attrs = [...(t.attrs ?? []), { key: "", value: "" }];
      objects[idx] = t;
      return { ...prev, objects };
    });

  //指定されたオブジェクトのスロットのキーまたは値を更新する関数
  const updateAttr = (idx: number, aidx: number, patch: Partial<Attr>) =>
    setSnapshot((prev) => {
      const objects = [...prev.objects];
      const o = {
        ...objects[idx],
        attrs: [...(objects[idx].attrs ?? [])],
      };
      o.attrs[aidx] = { ...o.attrs[aidx], ...patch };
      objects[idx] = o;
      return { ...prev, objects };
    });
  //指定されたスロットの削除
  const removeAttr = (idx: number, aidx: number) =>
    setSnapshot((prev) => {
      const objects = [...prev.objects];
      const o = {
        ...objects[idx],
        attrs: [...(objects[idx].attrs ?? [])],
      };
      o.attrs.splice(aidx, 1);
      objects[idx] = o;
      return { ...prev, objects };
    });
  //指定されたインデックスのオブジェクトを削除する関数
  const removeObject = (idx: number) =>
    setSnapshot((prev) => {
      const name = prev.objects[idx]?.name;
      const objects = prev.objects.filter((_, i) => i !== idx);
      const links = prev.links.filter(
        (l) => l.from !== name && l.to !== name
      );
      return { objects, links };
    });

  //ここからは表示(JSX)に関する記述
  //ユーザーが操作するフォームのHTML構造を定義してる
  return (
    <div className="rounded border p-3 space-y-3 text-sm max-h-80 overflow-y-auto">
      <div className="font-semibold">
        オブジェクトとスロットを問題文から探してこよう
      </div>
      {snapshot.objects.map((o, idx) => (
        //個々のオブジェクトのコンテナ．オブジェクトごとに枠線で囲まれたボックス
        <div key={idx} className="rounded border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              className="border rounded px-2 py-1 w-full text-xs"
              placeholder="例: 佐藤さん"
              value={o.name}
              onChange={(e) => updateName(idx, e.target.value)}
            />
            <button
              type="button"
              className="text-[10px] px-2 py-1 rounded border"
              onClick={() => removeObject(idx)}
            >
              削除
            </button>
          </div>
  
          <div className="space-y-1">
            {(o.attrs ?? []).map((a, aidx) => (
              <div key={aidx} className="flex items-center gap-2">
                <input
                  className="border rounded px-2 py-1 w-32 text-[10px]"
                  placeholder="key"
                  value={a.key}
                  onChange={(e) =>
                    updateAttr(idx, aidx, { key: e.target.value })
                  }
                />
                <input
                  className="border rounded px-2 py-1 flex-1 text-[10px]"
                  placeholder="value"
                  value={a.value}
                  onChange={(e) =>
                    updateAttr(idx, aidx, { value: e.target.value })
                  }
                />
                <button
                  type="button"
                  className="text-[10px] px-2 py-1 rounded border"
                  onClick={() => removeAttr(idx, aidx)}
                >
                  削除
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="mt-1 text-[10px] px-2 py-1 rounded border"
            onClick={() => addAttrTo(idx)}
          >
            ＋ スロットを追加する
          </button>
        </div>
      ))}

      <button
        type="button"
        className="px-3 py-1 rounded bg-black text-white text-xs"
        onClick={addObject}
      >
        ＋ オブジェクトを追加する
      </button>
    </div>
  );
}

/** =========================
 * LinkMiniAdder：自力リンク追加（重複チェック付き・即反映）
 * ========================= */
function LinkMiniAdder({
  snapshot,
  setSnapshot,
}: {
  snapshot: Snapshot;
  setSnapshot: React.Dispatch<React.SetStateAction<Snapshot>>;
}) {
  // オブジェクト名一覧（空文字は除外）
  const names = snapshot.objects.map((o) => o.name).filter((n) => !!n);
  const [msg, setMsg] = useState<string | null>(null);

  // オブジェクトが足りないとき
  if (names.length < 2) {
    return (
      <div className="text-xs text-neutral-500">
        リンクを作るには、少なくとも 2 つのオブジェクトを作成してください。
      </div>
    );
  }

  // 重複判定ヘルパ（selfIndex は「自分自身は除外する」ために使用）
  const isDuplicate = (
    links: Link[],
    candidate: Link,
    selfIndex: number | null
  ): boolean => {
    const normLabel = candidate.label ?? "";
    if (!candidate.from || !candidate.to) return false; // 未選択は重複扱いしない
    return links.some((l, i) => {
      if (selfIndex !== null && i === selfIndex) return false;
      return (
        l.from === candidate.from &&
        l.to === candidate.to &&
        (l.label ?? "") === normLabel
      );
    });
  };

  // 行追加：from/to/label を空で追加（ユーザーに選ばせる）
  const addRow = () => {
    setMsg(null);
    setSnapshot((prev) => ({
      ...prev,
      links: [...(prev.links ?? []), { from: "", to: "", label: "" }],
    }));
  };

  // 行更新（from/to/label を変えた瞬間に snapshot に反映）
  const updateLink = (index: number, patch: Partial<Link>) => {
    setSnapshot((prev) => {
      const links = [...(prev.links ?? [])];
      const current = links[index] || { from: "", to: "", label: "" };

      const next: Link = {
        from: patch.from ?? current.from,
        to: patch.to ?? current.to,
        label:
          patch.label !== undefined
            ? patch.label || undefined
            : current.label,
      };

      // 入力途中（from/to のどちらかが空）はそのまま許容
      if (!next.from || !next.to) {
        links[index] = next;
        setMsg(null);
        return { ...prev, links };
      }

      // 重複チェック（自分以外と同じならエラー表示して変更しない）
      if (isDuplicate(links, next, index)) {
        setMsg("同じリンクがすでにあります。");
        return prev;
      }

      links[index] = next;
      setMsg(null);
      return { ...prev, links };
    });
  };

  // 行削除
  const removeRow = (index: number) => {
    setMsg(null);
    setSnapshot((prev) => {
      const links = (prev.links ?? []).filter((_, i) => i !== index);
      return { ...prev, links };
    });
  };

  return (
    <div className="rounded border p-3 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-semibold">
          リンクを作成（編集内容は即プレビューに反映）
        </div>
        {msg && <div className="text-[10px] text-red-600">{msg}</div>}
      </div>

      {/* 既存リンク行の編集 */}
      <div className="space-y-2 max-h-40 overflow-y-auto">
        {snapshot.links.length === 0 && (
          <div className="text-neutral-500">
            まだリンクがありません。「＋ リンクを追加」で新しいリンクを作成してください。
          </div>
        )}

        {snapshot.links.map((l, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            {/* from */}
            <select
              className="border rounded px-2 py-1"
              value={l.from || ""}
              onChange={(e) => updateLink(i, { from: e.target.value })}
            >
              <option value="">from</option>
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>

            <span>→</span>

            {/* to */}
            <select
              className="border rounded px-2 py-1"
              value={l.to || ""}
              onChange={(e) => updateLink(i, { to: e.target.value })}
            >
              <option value="">to</option>
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>

            {/* label */}
            <input
              className="border rounded px-2 py-1 w-28"
              placeholder="ラベル（任意）"
              value={l.label ?? ""}
              onChange={(e) => updateLink(i, { label: e.target.value })}
            />

            {/* 削除 */}
            <button
              type="button"
              className="px-2 py-1 rounded border"
              onClick={() => removeRow(i)}
            >
              削除
            </button>
          </div>
        ))}
      </div>

      {/* 行追加ボタン */}
      <button
        type="button"
        className="px-3 py-1 rounded bg-black text-white"
        onClick={addRow}
      >
        ＋ リンクを追加
      </button>
    </div>
  );
}



/** =========================
 * 共通：upsertAttr
 * ========================= */
//特定のオブジェクトのスロットを追加または更新する処理
function upsertAttr(
  prev: Snapshot,
  of: string,
  key: string,
  value: string
): Snapshot {
  const objects = [...prev.objects];
  let i = objects.findIndex((o) => o.name === of);
  if (i < 0) {
    objects.push({ name: of, attrs: [{ key, value }] });
    i = objects.length - 1;
  } else {
    const o = { ...objects[i], attrs: [...(objects[i].attrs ?? [])] };
    const k = o.attrs.findIndex((a) => a.key === key);
    if (k >= 0) o.attrs[k] = { key, value };
    else o.attrs.push({ key, value });
    objects[i] = o;
  }
  return { ...prev, objects };
}
