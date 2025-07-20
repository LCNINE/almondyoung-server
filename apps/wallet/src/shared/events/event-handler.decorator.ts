import { OnEvent } from '@nestjs/event-emitter';
import { Injectable } from '@nestjs/common';

/**
 * 이벤트 핸들러 데코레이터
 * NestJS OnEvent 데코레이터를 래핑하여 추가 기능을 제공합니다.
 */
export function EventHandler(eventName: string, options?: {
  async?: boolean;
  suppressErrors?: boolean;
  prependListener?: boolean;
}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    // NestJS OnEvent 데코레이터 적용
    OnEvent(eventName, options)(target, propertyKey, descriptor);
    
    // 메타데이터 저장 (나중에 핸들러 등록 추적용)
    Reflect.defineMetadata('event:name', eventName, target, propertyKey);
    Reflect.defineMetadata('event:options', options || {}, target, propertyKey);
  };
}

/**
 * 이벤트 핸들러 클래스 데코레이터
 * 이벤트 핸들러 클래스임을 표시하고 자동으로 Injectable 데코레이터를 적용합니다.
 */
export function EventHandlerClass() {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    // Injectable 데코레이터 자동 적용
    Injectable()(constructor);
    
    // 이벤트 핸들러 클래스임을 표시
    Reflect.defineMetadata('event:handler-class', true, constructor);
    
    return constructor;
  };
}

/**
 * 이벤트 핸들러 메타데이터 추출 유틸리티
 */
export class EventHandlerMetadata {
  static getEventName(target: any, propertyKey: string): string | undefined {
    return Reflect.getMetadata('event:name', target, propertyKey);
  }

  static getEventOptions(target: any, propertyKey: string): any {
    return Reflect.getMetadata('event:options', target, propertyKey) || {};
  }

  static isEventHandlerClass(constructor: any): boolean {
    return Reflect.getMetadata('event:handler-class', constructor) === true;
  }

  static getEventHandlerMethods(target: any): string[] {
    const methods: string[] = [];
    const prototype = Object.getPrototypeOf(target);
    
    Object.getOwnPropertyNames(prototype).forEach(propertyKey => {
      if (this.getEventName(prototype, propertyKey)) {
        methods.push(propertyKey);
      }
    });
    
    return methods;
  }
}