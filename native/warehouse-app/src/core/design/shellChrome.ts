import { createContext } from 'react';

/** 화면을 감싼 셸이 무엇을 대신 그리는지. 스테이션 셸은 탭 바가 홈을 대신하므로 «홈으로 뒤로» 를 감춘다. */
export const ShellChromeContext = createContext({ hidesHomeBack: false });
