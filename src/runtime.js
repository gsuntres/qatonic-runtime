const _ = require('lodash')
const  {
  AdapterBase,
  Qualifier,
  Properties,
  ReporterBase,
  Session,
  display
} = require('@qatonic/core')
const { validateGroups } = require('./validator')
const { assertTests } = require('./tester')

class Runtime {

  constructor() {
    this._loader = null
    this._initContext = {}
    this._commands = {}
    this._runners = {}
    this._available = {}
    this._session = {}
    this._reporter = undefined
    this._skip = false
  }

  /**
   * @param {object}       config          Object with configuration. Available configuration:
   * @param {AdapterBase}  config.adapter  The adapter (e.g. AdapterFile).
   * @param {string[]}     config.plugins  A list of plugins this Runtime will be using.
   * @param {boolean}      config.skip     A boolean value to indicate whether to stop runners
   *                                       on a test failure (default: false).
   * @param {ReporterBase} config.reporter A reporter (e.g. cli Reporter)
   * @return {Promise} A void promise when done
   */
  init(config) {
    return new Promise((resolve, reject) => {
      const c = this._sanitizeConfig(config)

      this._skip = c.skip
      display.v('skip on error: ' + c.skip)

      // load plugins
      display.vv('loading plugins:')
      const pList = c.plugins
      for(let i = 0; i !== pList.length; i++) {
        try {
          display.vv(` loading ${pList[i]} plugin...`)
          this._available[pList[i]] = require(`@qatonic/plugin-${pList[i]}`)
          display.vv(` plugin ${pList[i]} loaded successfully.`)
        } catch(err) {
          display.vv(` plugin ${pList[i]} failed to load.`)
          display.vv(err.stack)
          return reject(err)
        }
      }

      // setup loader
      this._loader = c.loader
      display.vv(`using ${this._loader.name} loader.`)

      // reporter
      this._reporter = c.reporter
      display.vv(`using ${this._reporter.name} reporter.`)

      Promise.all([
        this._loadCommandGroups(),
        this._loadRunnerGroups(),
        this._loadContext()
      ]).then(results => {
          const promArr = []
          let promIdx = 0

          // find all commands and group them by commandGroup
          const commandGroups = results[promIdx++]
          for(let i = 0; i !== commandGroups.length; i++) {
            const g = commandGroups[i]
            promArr.push(
              this._loadCommands(g)
                .then(qNames => {
                  qNames.forEach(q => display.vv(` command ${q} loaded`))
                  this._commands[g] = qNames
                })
            )
          }

          // find all runners and group them by runnerGroup
          const runnerGroups = results[promIdx++]
          for(let i = 0; i !== runnerGroups.length; i++) {
            const g = runnerGroups[i]
            promArr.push(
              this._loadRunners(g)
                .then(qNames => {
                  qNames.forEach(q => display.vv(` runner ${q} loaded`))
                  this._runners[g] = qNames
                })
            )
          }

          // init context
          this._initContext = results[promIdx++]

          this._session = this._createSession()

          Promise.all(promArr).then(resolve).catch(reject)
        }).catch(err => reject(err))
    })
  }

  start(runners = []) {
    return new Promise(async resolve => {

      if(!runners || runners.length === 0) {
        const config = await this._loader.config()
        runners = config['runners'] || []
      }

      const resultRunners = {}

      for(let i = 0; i !== runners.length; i++) {
        const r = runners[i]
        const ret = await this.startRunner(r)
        resultRunners[r] = ret
        display.a(`${r} ${ret}`, 'white.bold')
      }

      resolve(resultRunners)
    })
  }

  startRunner(runnerQualifier) {
    return new Promise(resolve => {
      resolve(this.doStartRunner(runnerQualifier))
    })
  }

  async doStartRunner(qualifier) {
    let retMessage = '✓'

    if(!qualifier) throw new Error('Specify runner')
    let runnerQualifier = qualifier
    if(typeof runnerQualifier === 'string') {
      runnerQualifier = Qualifier.parse(qualifier)
    }

    // load runner
    let runner
    try {
      runner = await this._loader.runner(runnerQualifier)
    } catch(err) {
      return this._reporter.onRunnerError(runnerQualifier, err.message)
    }

    this._reporter.onRunner(runnerQualifier, runner.qualifier)

    // 1. iterate over steps
    const steps = runner.steps || []
    for(let i = 0; i !== steps.length; i++) {
      const step = steps[i]

      // 2. process context
      const entries = Object.entries(_.get(step, 'context', {}))

      for(let i= 0; i !== entries.length; i += 2) {
        this._session.updateContext(entries[i], entries[i + 1], Session.CONTEXT_SCOPES.STEP)
      }

      step.process(this._session.context)

      // 3. prepare command
      const preparedCommand = await this.prepareCommand({
          plugin: step.plugin,
          stepProps: step.props
        })

      // 4. run command
      this._reporter.onStep(runnerQualifier, preparedCommand.props, step.name + ' ' + preparedCommand.name)

      let results
      try {
        results = await this.doRunCommand(preparedCommand)
        display.vv(results)
      } catch(err) {
        this._reporter.onRunnerError(runnerQualifier, err.message)
        retMessage = err
        break
      }

      // 5. register variables
      if(results['output'] && step['register']) {
        try {
          this._processOutput(step['register'], results)
        } catch(err) {
          this.reporter.onRunnerError(runnerQualifier, err)
          retMessage = err
          break
        }
      }

      // 6. assert tests
      if(results && step['tests']) {
        const testResults = assertTests(step['tests'], results)
        let errorOccurred = undefined
        for(let i = 0; i !== testResults.length; i++) {
          const testResult = testResults[i]
          if(!errorOccurred && testResult.err) errorOccurred = testResult.err
          display.raw(chalk =>
            `${chalk.white(testResult.name)} ${testResult.err ? chalk.red('failed') : chalk.green('ok')}`
          )
          if(testResult.err) display.vv(testResult.err, 'red')
        }

        if(errorOccurred) {
          this._reporter.onRunnerError(runnerQualifier, errorOccurred)
          if(!step.skipOnFail) {
            display.a('skip is set to false. Will exit.')
            retMessage = errorOccurred
            break
          }
        }
      }

      // 7. clean up
      this._onStepDone()

      this._reporter.onStepDone(runnerQualifier, '')
    }

    this._reporter.onRunnerDone(runnerQualifier, retMessage)

    return retMessage
  }

  async runCommand(qname, stepProps = {}) {
    if(!qname) throw new Error('Specify a command to run')

    const qualifier= Qualifier.parse(qname)
    let command
    try {
      command = await this._loader.command(qualifier)
      command.process(this._session.context)
    } catch(err) {
      return this._reporter.onRunnerError(qualifier, err.message)
    }

    const preparedCommand = await this.prepareCommand({
      qualifier,
      command: command.processed,
      props: stepProps
    })

    return this.doRunCommand(preparedCommand)
  }

  prepareCommand(payload) {
    const {
      plugin,
      stepProps = {}
    } = payload

    return new Promise(async (resolve, reject) => {
      if(!_.includes(Object.keys(this._available), plugin)) {
        return reject(new Error(`\`${plugin}\` unsupported plugin`))
      }

      const props = await this._loader.properties(plugin)
      const pluginProps = new Properties(props)
      pluginProps.process(this._session.context)
      const propsToPass = Object.assign(stepProps, pluginProps.processed.props)
      resolve(new this._available[plugin](propsToPass))
    })
  }

  async doRunCommand(prepareCommand) {
    // check for delay
    const { delay } = prepareCommand.props
    if(delay && delay > 0) {
      await (() => new Promise(res => setTimeout(res, delay)))()
    }

    return prepareCommand.run()
  }

  get runners() {
    let r = []
    Object.keys(this._runners).forEach(g => {
      r = r.concat(this._expandRunner(g))
    })

    return r
  }

  _createSession() {
    return new Session(this._initContext)
  }

  _loadCommandGroups() {
    return new Promise((resolve, reject) => {
      this._loader.commandGroups().then(groups => {
        try {
          validateGroups(groups)
          resolve(groups)
        } catch(err) {
          reject(err)
        }
      })
    })
  }

  _loadRunnerGroups() {
    return new Promise((resolve, reject) => {
      this._loader.runnerGroups().then(groups => {
        try {
          validateGroups(groups)
          resolve(groups)
        } catch(err) {
          reject(err)
        }
      })
    })
  }

  _loadCommands(commandGroup) {
    return new Promise((resolve, reject) => {
      this._loader.commands(commandGroup)
         .then(commandNames => {
           const arr_ = []
           for(let i = 0; i !== commandNames.length; i++)
              arr_.push(new Qualifier(commandGroup, commandNames[i]))
           resolve(arr_)
         })
         .catch(reject)
       })
  }

  _loadContext() {
    return this._loader.context()
  }

  _loadRunners(runnerGroup) {
    return new Promise((resolve, reject) => {
      this._loader.runners(runnerGroup)
         .then(runnerNames => {
           const arr_ = []
           for(let i = 0; i !== runnerNames.length; i++) {
              arr_.push(new Qualifier(runnerGroup, runnerNames[i]))
            }
           resolve(arr_)
         })
         .catch(reject)
       })
  }

  _expandable(groupOrQualifier) {
    return !Qualifier.isQualifier(groupOrQualifier)
  }

  _expandRunner(group) {
    return this._runners[group]
  }

  _expandRunners(groupOrQualifierArr) {
    let expandedArr = [], arr = groupOrQualifierArr.slice()
    for(let i = 0; i !== arr.length; i++) {
      const groupOrQualifier = arr[i]
      if(this._expandable(groupOrQualifier)) {
        expandedArr = expandedArr.concat(this._expandRunner(groupOrQualifier))
      } else {
        const q = Qualifier.parse(groupOrQualifier)
        if(_.findIndex(expandedArr, o => _.isEqual(o, q)) === -1)
          expandedArr.push(q)
      }
    }

    return expandedArr
  }

  _runnersToStart(runnersAndGroups = []) {
    // which runners to use
    let runnersFromConfig = runnersAndGroups, runnersToStart = []

    // handle `all` keyword
    let hasAllKeyword = false
    const allIdx = _.findIndex(runnersFromConfig, o => o.trim() === 'all')
    if(allIdx > -1) {
        hasAllKeyword = true
        runnersFromConfig.splice(allIdx, 1)
    } else if(runnersFromConfig.length === 0) {
      hasAllKeyword = true
    }

    if(!_.isEmpty(runnersFromConfig)) {
      runnersToStart = this._expandRunners(runnersFromConfig)
    }

    // append the rest of the runners
    if(hasAllKeyword) {
      const grps = Object.keys(this._runners)
      for(let i = 0; i !== grps.length; i++) {
        const groupIdx = grps[i]
        const groupedRunners = this._runners[groupIdx]
        for(let j = 0; j !== groupedRunners.length; j++) {
          const r = groupedRunners[j]
          if(_.findIndex(runnersToStart, o => _.isEqual(o, r)) === -1)
            runnersToStart.push(r)
        }
      }
    }

    return runnersToStart
  }

  _processOutput(registerStatement, output) {
    // parse statement

    const keys = Object.keys(registerStatement)
    for(let i = 0; i !== keys.length; i++) {
      let section = 'output'
      let scope = Session.CONTEXT_SCOPES.GLOBAL
      let path

      const registerWhat = registerStatement[keys[i]]

      // is this an object
      if(_.isObject(registerWhat)) {
        section = _.get(registerWhat, 'section', 'output')
        const scopeStr = _.get(registerStatement, 'scope', 'global')
        scope = Session.getScope(scopeStr)
        path = _.get(registerWhat, 'path')
      } else {
        path = registerWhat
      }

      if(_.isUndefined(path)) throw new Error('path is required.')

      const f = new Function(`const section = this._.get(this.output, '${section}'); return this._.get(section, '${path}')`)
      const val = f.apply(Object.assign({}, {output}, {_}))
      this._session.updateContext(keys[i], val, scope)
    }
  }

  _onStepDone() {
    this._session.resetContext()
  }

  _onRunner() {
    this._session.resetContext(Session.CONTEXT_SCOPES.RUNNER)
  }

  _sanitizeConfig(config) {
    const c = {}

    // check plugins
    const pluginsCheck = config['plugins']
    if(pluginsCheck) {
      if(!Array.isArray(pluginsCheck))
        throw new Error('plugins should be an array of strings')
    } else {
      throw new Error('No plugins specified')
    }
    c.plugins = pluginsCheck

    // check loader
    const loaderCheck = config['loader']
    if(loaderCheck) {
      if(!(loaderCheck instanceof AdapterBase))
        throw new Error('loader should be of type AdapterBase')
    } else {
      throw new Error('Loader is required')
    }

    // check loader
    c.loader = loaderCheck

    // check skip
    c.skip = typeof config['skip'] !== 'undefined' ? config['skip'] : false

    // check reporter
    const reporterCheck = config['reporter']
    if(reporterCheck) {
      if(!(reporterCheck instanceof ReporterBase)) {
        throw new Error('reporter should be of type ReporterBase')
      }
    } else {
      throw new Error('Reporter is required')
    }

    // check callbacks
    c.reporter = reporterCheck

    return c
  }
}

module.exports = Runtime
