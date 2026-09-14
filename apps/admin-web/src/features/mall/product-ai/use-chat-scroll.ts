'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

/** Reserve one viewport for the newest question/answer; never drag readers away from older text. */
export function useChatScroll(
  sessionId: string | null,
  lastQuestionId?: string
) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [turn, setTurn] = useState<HTMLDivElement | null>(null);
  const [turnMinHeight, setTurnMinHeight] = useState(0);
  const [showLatest, setShowLatest] = useState(false);
  const followBottom = useRef(false);
  const userScroll = useRef(false);
  const positioned = useRef<{
    viewport: HTMLDivElement;
    turn: HTMLDivElement;
    question: string;
  } | null>(null);
  const update = useCallback(() => {
    if (!viewport) return;
    setShowLatest(
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 80
    );
  }, [viewport]);

  useEffect(() => {
    if (!viewport) return;
    const resize = new ResizeObserver(() => {
      const style = getComputedStyle(viewport);
      setTurnMinHeight(
        Math.max(
          0,
          viewport.clientHeight -
            parseFloat(style.paddingTop) -
            parseFloat(style.paddingBottom)
        )
      );
      if (followBottom.current) viewport.scrollTop = viewport.scrollHeight;
      update();
    });
    resize.observe(viewport);
    if (turn) resize.observe(turn);
    return () => resize.disconnect();
  }, [viewport, turn, update]);

  useLayoutEffect(() => {
    if (!viewport || !turn || !lastQuestionId) return;
    if (!turnMinHeight) {
      const style = getComputedStyle(viewport);
      setTurnMinHeight(
        Math.max(
          0,
          viewport.clientHeight -
            parseFloat(style.paddingTop) -
            parseFloat(style.paddingBottom)
        )
      );
      return;
    }
    if (
      positioned.current?.viewport === viewport &&
      positioned.current.turn === turn &&
      positioned.current.question === lastQuestionId
    )
      return;
    positioned.current = { viewport, turn, question: lastQuestionId };
    followBottom.current = false;
    userScroll.current = false;
    const top =
      turn.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top +
      viewport.scrollTop;
    viewport.scrollTop =
      top - parseFloat(getComputedStyle(viewport).paddingTop);
    update();
  }, [sessionId, lastQuestionId, viewport, turn, turnMinHeight, update]);

  return {
    viewportRef: setViewport,
    turnRef: setTurn,
    turnMinHeight,
    showLatest,
    onUserScrollIntent: () => {
      userScroll.current = true;
    },
    onScroll: () => {
      if (!viewport) return;
      if (userScroll.current)
        followBottom.current =
          viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
          80;
      update();
    },
    toLatest: () => {
      if (!viewport) return;
      followBottom.current = true;
      userScroll.current = true;
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
    },
  };
}
