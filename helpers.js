'use strict'

const talon = require('talon')
const address = require('address-rfc2822')
const stripTags = require('./striptags')
const debug = require('debug')('mailbot')


// Helper: extract signature from text body

exports.extractSignature = text => talon.signature.bruteforce.extractSignature(text)


// Helper: parse addresses (needed when working with triggerOnHeaders)

exports.parseAddresses = (headers, { quiet = false } = {}) => {
	_parseAddressHeader(headers, 'to', quiet)
	_parseAddressHeader(headers, 'cc', quiet)
	_parseAddressHeader(headers, 'bcc', quiet)
	_parseAddressHeader(headers, 'from', quiet, false)
	return headers
}

const _parseAddressHeader = (headers, field, quiet = false, multiple = true) => {
	if (multiple) {
		let addresses = headers[field]
		if (typeof addresses === 'string') {
			addresses = [addresses]
		} else if (!addresses) {
			addresses = []
		}
		headers[field] = addresses.map(address => _parseAddressValue(address, quiet))
	} else {
		let value = headers[field]
		if (Array.isArray(value)) {
			if (value.length === 0) {
				headers[field] = null
				return
			} else if (value.length === 1) {
				value = value[0]
			} else {
				debug('Error parsing address: expecting non-multiple values and got', value)
				if (!quiet) {
					throw new Error('Non multiple value expected for header "' + field + '"')
				}
			}
		}
		headers[field] = _parseAddressValue(value)
	}
}

const _parseAddressValue = (value, quiet = false) => {
	let parsed
	try {
		parsed = address.parse(value)[0]
	} catch (err) {
		debug('Error parsing address', value, err)
		if (quiet) {
			parsed = {}
		} else {
			throw err
		}
	}
	parsed.raw = value
	return parsed
}


// Helper: strip tags

exports.stripTags = stripTags
