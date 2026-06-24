const { logs, SeverityNumber } = require('@opentelemetry/api-logs');
const { logger: defaultLogger } = require('@medusajs/framework/logger');

const serviceName = process.env.OTEL_SERVICE_NAME || 'medusa';

const severityByLevel = {
  panic: SeverityNumber.FATAL,
  error: SeverityNumber.ERROR,
  failure: SeverityNumber.ERROR,
  warn: SeverityNumber.WARN,
  success: SeverityNumber.INFO,
  info: SeverityNumber.INFO,
  http: SeverityNumber.INFO,
  verbose: SeverityNumber.DEBUG,
  debug: SeverityNumber.DEBUG,
  silly: SeverityNumber.TRACE,
  log: SeverityNumber.INFO,
  activity: SeverityNumber.INFO,
  progress: SeverityNumber.INFO,
};

function deploymentEnvironment() {
  return process.env.NODE_ENV === 'production' ? 'production' : process.env.NODE_ENV || 'development';
}

function toLogBody(value) {
  if (value instanceof Error) {
    return value.stack || value.message;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function errorAttributes(value, error) {
  const err = error instanceof Error ? error : value instanceof Error ? value : undefined;
  if (!err) {
    return {};
  }
  return {
    'exception.type': err.name,
    'exception.message': err.message,
    ...(err.stack ? { 'exception.stacktrace': err.stack } : {}),
  };
}

function compactAttributes(attributes) {
  return Object.fromEntries(Object.entries(attributes).filter(([, value]) => value !== undefined));
}

function emit(level, messageOrError, error, extraAttributes = {}) {
  try {
    const body = toLogBody(messageOrError);
    logs.getLogger(serviceName).emit({
      severityNumber: severityByLevel[level] || SeverityNumber.INFO,
      severityText: level.toUpperCase(),
      eventName: `medusa.${level}`,
      body,
      attributes: compactAttributes({
        event: `medusa.${level}`,
        'service.name': serviceName,
        service_name: serviceName,
        'deployment.environment': deploymentEnvironment(),
        deployment_environment: deploymentEnvironment(),
        component: 'medusa',
        ...errorAttributes(messageOrError, error),
        ...extraAttributes,
      }),
    });
  } catch {
    // Logging must never affect application behavior.
  }
}

function callDefault(method, args) {
  const fn = defaultLogger[method];
  if (typeof fn === 'function') {
    return fn.apply(defaultLogger, args);
  }
}

const logger = {
  panic(data) {
    callDefault('panic', [data]);
    emit('panic', data);
  },
  shouldLog(level) {
    return defaultLogger.shouldLog(level);
  },
  setLogLevel(level) {
    callDefault('setLogLevel', [level]);
  },
  unsetLogLevel() {
    callDefault('unsetLogLevel', []);
  },
  activity(message, config) {
    const activityId = callDefault('activity', [message, config]);
    emit('activity', message, undefined, { activity_id: activityId });
    return activityId;
  },
  progress(activityId, message) {
    callDefault('progress', [activityId, message]);
    emit('progress', message, undefined, { activity_id: activityId });
  },
  error(messageOrError, error) {
    callDefault('error', [messageOrError, error]);
    emit('error', messageOrError, error);
  },
  failure(activityId, message) {
    const result = callDefault('failure', [activityId, message]);
    emit('failure', message, undefined, { activity_id: activityId });
    return result;
  },
  success(activityId, message) {
    const result = callDefault('success', [activityId, message]);
    emit('success', message, undefined, { activity_id: activityId });
    return result;
  },
  silly(message) {
    callDefault('silly', [message]);
    emit('silly', message);
  },
  debug(message) {
    callDefault('debug', [message]);
    emit('debug', message);
  },
  verbose(message) {
    callDefault('verbose', [message]);
    emit('verbose', message);
  },
  http(message) {
    callDefault('http', [message]);
    emit('http', message);
  },
  info(message) {
    callDefault('info', [message]);
    emit('info', message);
  },
  warn(message) {
    callDefault('warn', [message]);
    emit('warn', message);
  },
  log(...args) {
    callDefault('log', args);
    emit('log', args.map(toLogBody).join(' '));
  },
};

module.exports = { logger };
