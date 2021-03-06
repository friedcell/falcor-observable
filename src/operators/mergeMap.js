// @flow
"use strict";

import type {
  ObservableInput,
  OperatorFunction,
  ISubscription,
  ISubscriptionObserver
} from "../es-observable";
import type { IOuterSubscriber } from "../subscriber";
const { Observable } = require("../es-observable");
const { tryCatchResult, symbolError, popError } = require("../try-catch");
const { projectToObservable } = require("../project");
const { InnerSubscriber } = require("../subscriber");

class MergeMapSubscriber<T, I, R, E> implements IOuterSubscriber<T, I, E> {
  destination: ISubscriptionObserver<R, E>;
  project: ?(value: T, i: number) => ObservableInput<I, E>;
  resultSelector: ?(
    outerValue: T,
    innerValue: I,
    outerIndex: number,
    innerIndex: number
  ) => ObservableInput<R, E>;
  concurrent: number;
  innerSubs: Set<InnerSubscriber<T, I, E>>;
  buffer: T[];
  index: number;
  active: number;
  hasCompleted: boolean;
  closed: boolean;
  subscription: ISubscription | null;

  constructor(
    destination: ISubscriptionObserver<R, E>,
    project: ?(value: T, i: number) => ObservableInput<I, E>,
    resultSelector: ?(
      outerValue: T,
      innerValue: I,
      outerIndex: number,
      innerIndex: number
    ) => ObservableInput<R, E>,
    concurrent: number
  ): void {
    this.destination = destination;
    this.project = project;
    this.resultSelector = resultSelector;
    this.concurrent = concurrent;
    this.innerSubs = new Set();
    this.buffer = [];
    this.index = 0;
    this.active = 0;
    this.hasCompleted = false;
    this.closed = false;
    this.subscription = null;
  }
  start(subscription: ISubscription): void {
    this.subscription = subscription;
  }
  next(value: T): void {
    if (this.active < this.concurrent) {
      this.projectTo(value);
    } else {
      this.buffer.push(value);
    }
  }
  error(e: E): void {
    this.destination.error(e);
    for (const s of this.innerSubs) {
      s.unsubscribe();
    }
    this.innerSubs.clear();
    this.closed = true;
  }
  complete(): void {
    this.hasCompleted = true;
    if (this.active === 0) {
      this.destination.complete();
      this.closed = true;
    }
  }
  projectTo(value: T): void {
    const i = this.index++;
    const obs = projectToObservable(this.project, value, i);
    const innerSub = new InnerSubscriber(this, value, i);
    this.innerSubs.add(innerSub);
    this.active++;
    obs.subscribe(innerSub);
  }
  notifyNext(
    outerValue: T,
    innerValue: I,
    outerIndex: number,
    innerIndex: number,
    innerSub: InnerSubscriber<T, I, E>
  ): void {
    const { resultSelector } = this;
    if (typeof resultSelector !== "function") {
      this.destination.next((innerValue: any));
      return;
    }
    const result = tryCatchResult(
      resultSelector,
      outerValue,
      innerValue,
      outerIndex,
      innerIndex
    );
    if (result === symbolError) {
      this.destination.error((popError(): any));
      return;
    }
    this.destination.next(result);
  }
  notifyError(e: E, innerSub: InnerSubscriber<T, I, E>): void {
    this.destination.error(e);
    this.innerSubs.delete(innerSub);
  }
  notifyComplete(innerSub: InnerSubscriber<T, I, E>): void {
    this.active--;
    this.innerSubs.delete(innerSub);
    if (this.buffer.length !== 0) {
      this.projectTo(this.buffer.shift());
    } else if (this.hasCompleted && this.active === 0) {
      this.destination.complete();
    }
  }
  unsubscribe(): void {
    if (this.closed) {
      return;
    }
    const { subscription } = this;
    if (subscription !== null) {
      subscription.unsubscribe();
    }
    for (const s of this.innerSubs) {
      s.unsubscribe();
    }
    this.innerSubs.clear();
    this.closed = true;
  }
}

function _mergeMap<T, I, R, E>(
  project: ?(value: T, i: number) => ObservableInput<I, E>,
  resultSelector: ?(
    outerValue: T,
    innerValue: I,
    outerIndex: number,
    innerIndex: number
  ) => ObservableInput<R, E>,
  concurrent: number = Number.POSITIVE_INFINITY
): any {
  return function mergeMapOperator(source) {
    return new Observable(observer => {
      const sub = new MergeMapSubscriber(
        observer,
        project,
        resultSelector,
        concurrent
      );
      source.subscribe(sub);
      return sub;
    });
  };
}

declare function mergeMap<T, R, E>(
  project: (value: T, i: number) => ObservableInput<R, E>,
  concurrent?: number
): OperatorFunction<T, R, E>;

declare function mergeMap<T, I, R, E>(
  project: (value: T, i: number) => ObservableInput<I, E>,
  resultSelector: (
    outerValue: T,
    innerValue: I,
    outerIndex: number,
    innerIndex: number
  ) => ObservableInput<R, E>,
  concurrent?: number
): OperatorFunction<T, R, E>;

function mergeMap(project, resultSelector, concurrent) {
  return typeof resultSelector === "number"
    ? _mergeMap(project, null, resultSelector)
    : _mergeMap(project, resultSelector, concurrent);
}

module.exports = { mergeMap, _mergeMap };
