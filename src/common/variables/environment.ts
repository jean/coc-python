// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as fs from 'fs-extra'
import { inject, injectable } from 'inversify'
import * as path from 'path'
import { IPathUtils } from '../types'
import { EnvironmentVariables, IEnvironmentVariablesService } from './types'

@injectable()
export class EnvironmentVariablesService implements IEnvironmentVariablesService {
  private readonly pathVariable: 'PATH' | 'Path'
  constructor(@inject(IPathUtils) pathUtils: IPathUtils) {
    this.pathVariable = pathUtils.getPathVariableName()
  }
  public async parseFile(filePath?: string, baseVars?: EnvironmentVariables): Promise<EnvironmentVariables | undefined> {
    if (!filePath || !await fs.pathExists(filePath)) {
      return
    }
    if (!fs.lstatSync(filePath).isFile()) {
      return
    }
    return parseEnvFile(await fs.readFile(filePath), baseVars)
  }
  public mergeVariables(source: EnvironmentVariables, target: EnvironmentVariables) {
    if (!target) {
      return
    }
    const settingsNotToMerge = ['PYTHONPATH', this.pathVariable]
    Object.keys(source).forEach(setting => {
      if (settingsNotToMerge.indexOf(setting) >= 0) {
        return
      }
      if (target[setting] === undefined) {
        target[setting] = source[setting]
      }
    })
  }
  public appendPythonPath(vars: EnvironmentVariables, ...pythonPaths: string[]) {
    return this.appendPaths(vars, 'PYTHONPATH', ...pythonPaths)
  }
  public appendPath(vars: EnvironmentVariables, ...paths: string[]) {
    return this.appendPaths(vars, this.pathVariable, ...paths)
  }
  private appendPaths(vars: EnvironmentVariables, variableName: 'PATH' | 'Path' | 'PYTHONPATH', ...pathsToAppend: string[]) {
    const valueToAppend = pathsToAppend
      .filter(item => typeof item === 'string' && item.trim().length > 0)
      .map(item => item.trim())
      .join(path.delimiter)
    if (valueToAppend.length === 0) {
      return vars
    }

    const variable = vars ? vars[variableName] : undefined
    if (variable && typeof variable === 'string' && variable.length > 0) {
      vars[variableName] = variable + path.delimiter + valueToAppend
    } else {
      vars[variableName] = valueToAppend
    }
    return vars
  }
}

export function parseEnvFile(
  lines: string | Buffer,
  baseVars?: EnvironmentVariables
): EnvironmentVariables {
  const globalVars = baseVars ? baseVars : {}
  const vars: EnvironmentVariables = {}
  lines.toString().split('\n').forEach((line, _idx) => {
    const [name, value] = parseEnvLine(line)
    if (name === '') {
      return
    }
    vars[name] = substituteEnvVars(value, vars, globalVars)
  })
  return vars
}

function parseEnvLine(line: string): [string, string] {
  // Most of the following is an adaptation of the dotenv code:
  //   https://github.com/motdotla/dotenv/blob/master/lib/main.js#L32
  // We don't use dotenv here because it loses ordering, which is
  // significant for substitution.
  const match = line.match(/^\s*([a-zA-Z]\w*)\s*=\s*(.*?)?\s*$/)
  if (!match) {
    return ['', '']
  }

  const name = match[1]
  let value = match[2]
  if (value && value !== '') {
    if (value[0] === '\'' && value[value.length - 1] === '\'') {
      value = value.substring(1, value.length - 1)
      value = value.replace(/\\n/gm, '\n')
    } else if (value[0] === '"' && value[value.length - 1] === '"') {
      value = value.substring(1, value.length - 1)
      value = value.replace(/\\n/gm, '\n')
    }
  } else {
    value = ''
  }

  return [name, value]
}

const SUBST_REGEX = /\${([a-zA-Z]\w*)?([^}\w].*)?}/g

function substituteEnvVars(
  value: string,
  localVars: EnvironmentVariables,
  globalVars: EnvironmentVariables,
  missing = ''
): string {
  // Substitution here is inspired a little by dotenv-expand:
  //   https://github.com/motdotla/dotenv-expand/blob/master/lib/main.js

  let invalid = false
  let replacement = value
  replacement = replacement.replace(SUBST_REGEX, (match, substName, bogus, offset, orig) => {
    if (offset > 0 && orig[offset - 1] === '\\') {
      return match
    }
    if ((bogus && bogus !== '') || !substName || substName === '') {
      invalid = true
      return match
    }
    return localVars[substName] || globalVars[substName] || missing
  })
  if (!invalid && replacement !== value) {
    value = replacement
  }

  return value.replace(/\\\$/g, '$')
}
