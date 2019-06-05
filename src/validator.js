const _ = require('lodash')

const FILENAME_REGEX = /^(\w+)(\.json)?$/

const INVALID_GROUP_REGEX = /^\w+\.\w+$/

const RESERVED_WORDS = [
  'properties'
]

const isValidName = (name) => {
  checkReserved(name)

  if(!FILENAME_REGEX.test(name))
    throw new Error(`${name} is an invalid name`)

  return true
}

const isValidGroupName = (name) => {
  checkReserved(name)

  if(INVALID_GROUP_REGEX.test(name))
    throw new Error(`${name} is an invalid name`)

  return true
}

const validateGroups = (groupsArr) => {
  for(let i = 0; i !== groupsArr.length; i++)
    isValidGroupName(groupsArr[i])
}

const validateNames = (filenamesArr) => {
  for(let i = 0; i !== filenamesArr.length; i++)
    isValidName(filenamesArr[i])
}

function checkReserved(name) {
  if(_.indexOf(RESERVED_WORDS, name) !== -1)
    throw new Error(`${name} is a reserved word`)
}

module.exports = {
  validateGroups,
  validateNames
}
