'use strict';

const cloneDeep = require('lodash/cloneDeep');
const forIn = require('lodash/forIn');
const isArray = require('lodash/isArray');
const isEmpty = require('lodash/isEmpty');
const isObject = require('lodash/isObject');
const isString = require('lodash/isString');
const pull = require('lodash/pull');
const startsWith = require('lodash/startsWith');
const stringify = require('json-stable-stringify');

const RETRY_INTERVAL_MS = 5000;

function getWebSocketURL(requestor) {
	const loc = window.location;
	const new_uri = (loc.protocol === 'https:') ? 'wss:' : 'ws:';
	if (startsWith(requestor.websocketURL, '//')) {
		return `${new_uri}${requestor.websocketURL}`;
	} else {
		return `${new_uri}//${loc.host}${loc.pathname}${requestor.websocketURL}`;
	}
}

function establishConnection(requestor, callback) {
	requestor.socket = new WebSocket(getWebSocketURL(requestor));

	// on open
	requestor.socket.onopen = function() {
		requestor.isOpen = true;
		console.log(`WebSocket connection established on /${requestor.websocketURL}`);
		callback(null, requestor);
	};
	// on message
	requestor.socket.onmessage = function(event) {
		const res = JSON.parse(event.data);
		// NOTE: save success and error here, as we need to remove them to hash
		// correctly
		const success = res.success;
		const error = res.error;
		const hash = requestor.getHash(res, false);
		if (!requestor.requests.has(hash)) {
			console.error('Unrecognized response: ', res,  ', discarding');
			return;
		}
		const wrapped = requestor.requests.get(hash);
		requestor.requests.delete(hash);
		if (success) {
			wrapped.resolve(requestor.httpURL);
		} else {
			wrapped.reject(new Error(error));
		}
	};
	// on close
	requestor.socket.onclose = function() {
		// log close only if connection was ever open
		if (requestor.isOpen) {
			console.warn(`WebSocket connection on /${requestor.websocketURL} lost, attempting to reconnect in ${RETRY_INTERVAL_MS}ms`);
		}
		requestor.socket = null;
		requestor.isOpen = false;
		// reject all current requests
		requestor.requests.forEach(wrapped => {
			wrapped.reject();
		});
		// clear request map
		requestor.requests = new Map();
		// attempt to re-establish connection
		setTimeout(() => {
			establishConnection(requestor, () => {
				// once connection is re-established, send pending requests
				requestor.pending.forEach(wrapped => {
					requestor.requests.set(wrapped.hash, wrapped);
					requestor.socket.send(JSON.stringify(wrapped.request));
				});
				// clear pending map
				requestor.pending = new Map();
			});
		}, RETRY_INTERVAL_MS);
	};
}

function prune(current) {
	forIn(current, (value, key) => {
		if (value === undefined ||
			value == null ||
			(isString(value) && isEmpty(value)) ||
			(isObject(value) && isEmpty(prune(value)))) {
			delete current[key];
		}
	});
	// remove any leftover undefined values from the delete
	// operation on an array
	if (isArray(current)) {
		pull(current, undefined);
	}
	return current;
}

function pruneEmpty(obj, clone) {
	return clone ? prune(cloneDeep(obj)) : prune(obj);
}

function wrappedPromise(hash, request) {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return {
		hash: hash,
		request: request,
		promise: promise,
		resolve: resolve,
		reject: reject
	};
}

function stripURL(url) {
	if (!url || !isString(url)) {
		throw `Provided URL \`${url}\` is invalid`;
	}

	// strip leading `/`, but assume `//` specifies the host name
	if (startsWith(url, '/') && !startsWith(url, '//')) {
		url = url.substring(1, url.length);
	}

	// strip trailing `/`
	url = (url[url.length - 1] === '/') ? url.substring(0, url.length - 1) : url;
	return url;
}

class Requestor {
	constructor(websocketURL, httpURL, callback) {
		this.websocketURL = stripURL(websocketURL);
		this.httpURL = stripURL(httpURL);
		this.requests = new Map();
		this.pending = new Map();
		this.isOpen = false;
		establishConnection(this, callback);
	}
	getHash(req) {
		// NOTE: need to remove the success / error attributes otherwise
		// the request hashes wont match the response hashes.
		req.error = undefined;
		req.success = undefined;
		return stringify(pruneEmpty(req));
	}
	get(req) {
		const hash = this.getHash(req, true);
		if (!this.isOpen) {
			// see if we already have a pending request
			let pending = this.pending.get(hash);
			if (pending) {
				return pending.promise;
			}
			// if no pending request, add wrapped promise to pending queue
			pending = wrappedPromise(hash, req);
			this.pending.set(hash, pending);
			return pending.promise;
		}
		// see if we already have a request
		let wrapped = this.requests.get(hash);
		if (wrapped) {
			return wrapped.promise;
		}
		// if no existing reuqest, create wrapped promise and add to map
		wrapped = wrappedPromise(hash, req);
		this.requests.set(hash, wrapped);
		this.socket.send(JSON.stringify(wrapped.request));
		return wrapped.promise;
	}
	close() {
		this.socket.onclose = null;
		this.socket.close();
		this.socket = null;
		console.warn(`WebSocket connection on /${this.websocketURL} closed`);
	}
}

module.exports = Requestor;
