const {
  validateGroups,
  validateNames
} = require('../src/validator')

const VALID_GROUPS = ['group1', 'group2']
const INVALID_GROUPS = ['group1', 'group.2']
const VALID_FILENAMES = ['my_step', 'my_other_step']
const INVALID_FILENAMES = ['my_step', 'my_other.step']

describe('validator', () => {

  describe('#validateGroups', () => {
    it('pass successfully', () => {
      assert.doesNotThrow(() => {validateGroups(VALID_GROUPS)})
    })
    it('throw invalid name', () => {
      assert.throws(() => {validateGroups(INVALID_GROUPS)})
    })
  })

  describe('#validateNames', () => {
    it('pass successfully', () => {
      assert.doesNotThrow(() => {validateNames(VALID_FILENAMES)})
    })
    it('throw invalid name', () => {
      assert.throws(() => {validateNames(INVALID_FILENAMES)})
    })
  })

})
