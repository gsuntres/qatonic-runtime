const Runtime = require('../src/runtime')
const {
  AdapterBase,
  ReporterBase
} = require('@qatonic/core')

const RUNNER_OBJ = [
  {
    name: 'command 1',
    http: { url: '/bla' }
  }, {
    name: 'command 2',
    foo: { bar: 100 }
  }
]

const RUNNER_OBJ_STR = JSON.stringify(RUNNER_OBJ)

class MockedLoader extends AdapterBase {
  commandGroups() {
    return Promise.resolve(['group1'])
  }
  runnerGroups() {
    return Promise.resolve(['group1'])
  }
  context() {
    return {}
  }
  commands() {
    return Promise.resolve(['group1.command1'])
  }
  runners() {
    return Promise.resolve(['group1.runner1'])
  }
  runner() {
    return Promise.resolve(RUNNER_OBJ_STR)
  }
}

class MockedReporter extends ReporterBase {
}

const LOADER = new MockedLoader()
const REPORTER = new MockedReporter()
const RUNTIME = new Runtime()

describe('Runtime', () => {

  before(done => {
    // utilize runner
    RUNTIME.init({
      plugins: ['http'],
      loader: LOADER,
      reporter: REPORTER
    }).then(() => {
      assert.isTrue(true)
      done()
    }).catch(done)
  })

  describe('#_sanitizeConfig()', () => {

    it('require loader', () => {
      const config = {
        plugins: ['http'],
        loader: undefined,
        reporter: REPORTER
      }
      assert.throws(() => { RUNTIME._sanitizeConfig(config) }, 'Loader is required')
    })

    it('require reporter', () => {
      const config = {
        plugins: ['http'],
        loader: LOADER,
        reporter: undefined
      }
      assert.throws(() => { RUNTIME._sanitizeConfig(config) }, 'Reporter is required')
    })

    it('define plugins', () => {
      const config = {
        plugins: ['http'],
        loader: LOADER,
        reporter: REPORTER
      }
      const c = RUNTIME._sanitizeConfig(config)
      assert.deepEqual(c.plugins, ['http'])
    })

  })

})
