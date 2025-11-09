"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

type ProblemConfigState = {
  classProblemText: string;
  objectProblemText: string;
  classAnswerPuml: string;
  objectAnswerPuml: string;
};

type ProblemConfig = ProblemConfigState & {
  setClassProblemText: (v: string) => void;
  setObjectProblemText: (v: string) => void;
  setClassAnswerPuml: (v: string) => void;
  setObjectAnswerPuml: (v: string) => void;
  resetAll: () => void;
};

const STORAGE_KEY = "object-class-converter-config-v1";

const noop = () => {};

const ProblemConfigContext = createContext<ProblemConfig>({
  classProblemText: "",
  objectProblemText: "",
  classAnswerPuml: "",
  objectAnswerPuml: "",
  setClassProblemText: noop,
  setObjectProblemText: noop,
  setClassAnswerPuml: noop,
  setObjectAnswerPuml: noop,
  resetAll: noop,
});

export function ProblemConfigProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState<ProblemConfigState>({
    classProblemText: "",
    objectProblemText: "",
    classAnswerPuml: "",
    objectAnswerPuml: "",
  });

  // 初回: localStorage から読み込み
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setState((prev) => ({
        ...prev,
        ...["classProblemText", "objectProblemText", "classAnswerPuml", "objectAnswerPuml"].reduce(
          (acc, k) => ({
            ...acc,
            [k]:
              typeof parsed?.[k] === "string"
                ? String(parsed[k]).trim()
                : prev[k as keyof ProblemConfigState],
          }),
          {}
        ),
      }));
    } catch {
      // 壊れてたら無視
    }
  }, []);

  // 変更があったら localStorage に保存
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 保存できなくてもアプリは動くので無視
    }
  }, [state]);

  const value: ProblemConfig = {
    ...state,
    setClassProblemText: (v) =>
      setState((s) => ({ ...s, classProblemText: v })),
    setObjectProblemText: (v) =>
      setState((s) => ({ ...s, objectProblemText: v })),
    setClassAnswerPuml: (v) =>
      setState((s) => ({ ...s, classAnswerPuml: v })),
    setObjectAnswerPuml: (v) =>
      setState((s) => ({ ...s, objectAnswerPuml: v })),
    resetAll: () =>
      setState({
        classProblemText: "",
        objectProblemText: "",
        classAnswerPuml: "",
        objectAnswerPuml: "",
      }),
  };

  return (
    <ProblemConfigContext.Provider value={value}>
      {children}
    </ProblemConfigContext.Provider>
  );
}

export function useProblemConfig() {
  return useContext(ProblemConfigContext);
}
