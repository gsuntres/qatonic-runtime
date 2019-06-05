const { assert } = require('chai')
const _ = require('lodash')

module.exports.assertTests = (tests = [], context = {}) => {
  const resultStatus = []
  for(let i = 0; i !== tests.length; i++) {
    const {
      type,
      actual,
      expected,
      message
    } = tests[i]

    let testBody =`this.assert.${type}(this.context.${actual}, '${expected}'`

    if(typeof message !== 'undefined') {
      const msg = _.get(context['output'], message, message)

      if(!_.isNil(msg) && _.isString(msg)) testBody += ', \'' + msg + '\''
    }

    testBody += ')'

    const name = displayName(type, actual, expected)
    try {
      const f = new Function(testBody)

      f.apply(Object.assign({}, {assert}, {context}))
      resultStatus.push({
        name,
        err: undefined
      })
    } catch(err) {
      resultStatus.push({
        name,
        err
      })
    }
  }

  return resultStatus
}


function displayName(type, actual, expected) {
  return `${actual}, ${type}, ${expected}`
}
