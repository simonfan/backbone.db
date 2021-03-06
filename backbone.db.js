define(['backbone','jquery','underscore','backbone.db.filtered'],
function(Backbone , $      , undef      , Filtered             ) {

	var DB = Backbone.DB = Backbone.Collection.extend({
		initialize: function(models, options) {
			options = options || {};
			this.initDb(options);
		},

		initDb: function(options) {
			/**
			 * Options:
			 * 	- url: the endpoint (required)
			 *  - pageLength: the default value for page length
			 * 	- ajaxOptions: custom jqXHR options set for all requests made by db.
			 * 	- uniqueAttr: list of attributes that have a unique value, so that 
			 *		the db may securely look for just one model instead of looking for a list of models.
			 */

			_.bindAll(this,'request','_requestByParams','_asynchRequest');

			this.pageLength = options.pageLength || 10;

			this.ajaxOptions = options.ajaxOptions;

			/**
			 * Unique attributes help accelerate data fetching by
			 * letting the Backbone DB instance know that if it can find one
			 * model with the uniqueAttr corresponding to the request params
			 * it can securely return the result without cheking with the server if there are
			 * other possible results.
			 */
			this.uniqueAttr = _.union(['id'], options.uniqueAttr);


			/**
			 * object on which the loaded ids for a given data-set
			 * are stored
			 */
			this.loaded = {};


			/**
			 * Object where the attribute filters are stored.
			 * 
			 * Attribute Filters are applied even when the attributes do not exist on the models!
			 Thi is really powerful.
			 */
			this.attrFilters = _.extend({}, this.attrFilters);


			/**
			 * Cache the requests
			 */
			this._cache = {};
		},

		/** 
		 * The db default behaviour is to order the models by id. (considering id as a number.)
		 */
		comparator: function(model) {
			return parseInt(model.get('id'));
		},


		/**
		 * Method to directly read attributes from models
		 * Returns array of attribute values
		 */
		pluckRequest: function(attr, params, initial, pageLength) {
			/**
			 * attr: string defining which is the value to be read.
			 */

			var req = this.request(params, initial, pageLength);

			return req.then(function(res) {
				// res is a list of models
				return _.map(res, function(m) {
					return m.get(attr);
				})
			});
		},

		/**
		 * Method to pick attributes from models
		 * Returns array of objects containing the specified attr values.
		 */
		pickRequest: function(attr, params, initial, pageLength) {
			/**
			 * attr: string or array of attribute names to be picked.
			 */
			var req = this.request(params, initial, pageLength);

			return req.then(function(res) {
				return _.map(res, function(m) {
					return m.pick(attr);
				});
			});
		},

		/**
		 * Method to request models!
		 * Returns a promise, resolves with the request result
		 * The request result may be either an array of models or a single model.
		 */
		request: function(params, initial, pageLength) {
			/**
			 * params: 
			 	- object: hash containing request parameters
			 	- string: id or cid
			 	- array: array of request parameters
			 * initial: number
			 * pageLength: number
			 */

			// normalize initial and pageLength
			initial = !_.isUndefined(initial) ? initial : 0;
			pageLength = (pageLength && pageLength > 0) ? pageLength : this.pageLength;

			// transform pageLength into number
			var options = {
				initial: parseInt(initial),
				pageLength: parseInt(pageLength),
			}
			
			// check for array first of all!
			if (_.isArray(params)) {
				// multiple request
				return this._requestMultiple(params, options);

			} else if (typeof params === 'object') {

				// query request
				return this._requestByParams(params, options);

			} else if (typeof params === 'string' || typeof params === 'number') {

				// id request
				return this._requestById(params);
			} 
		},


		/**
		 * Check if given request has already been sent.
		 * If so, return the promise of the sent request.
		 * The method is a getter and a setter.
		 */
		cache: function(params, promise) {

				// the request identifier is a JSON string.
			var requestIdentifier = JSON.stringify(params);

			if (typeof promise === 'undefined') {
				// get
				return this._cache[ requestIdentifier ];
			} else {
				// set
				return this._cache[ requestIdentifier ] = promise;
			}
		},

		/**
		 * Runs a request with multiple sub requests
		 */
		_requestMultiple: function(params, options) {

			var _this = this,
				defer = $.Deferred(),
				subRequests = _.map(params, function(p) {
					return _this.request(p, options.initial, options.pageLength);
				});

			if (subRequests.length > 0) {

				$.when.apply(null, subRequests)
					.then(function() {
						// solve the defer with an array containing the results of the sub
						// requests.
						defer.resolve( Array.prototype.splice.call(arguments, 0) );
					});

			} else {
				defer.resolve([]);
			}

			return defer;
		},


		/**
		 * Tries to get a model by id (backbone collection.get(id))
		 * If unsuccessful, 
		 * Fetches a model by ID from the endpoint.
		 * It is actually a facade for _requestByParams
		 */
		_requestById: function(id) {
			var model = this.get(id);

			if (model) {
				// return a resolved defer object.
				return $.Deferred().resolve(model);

			} else {
				// _requestByParams(defer, params, options)
				
				return this._requestByParams(
					{ id: id },
					{
						initial: 0,
						pageLength: 1
					}
				);
			}
		},

		/**
		 * This method is pretty tricky:
		 *  1: It does a synch query (this.query), 
		 *	2: sends a request to the server with
		 		- initial
		 		- pageLength
		 		- notIn: a list of item ids to be ignores (here is the trick!)
		 		TRICK: by sending a list of ids of models that we already loaded on the client,
		 		we tell the server to just 'fill the gaps'
		 		When the request returns, we add the 'gap models' to our client DB and the database 
		 		is synched!
		 	3: waits for the _asynchResponse to do whatever processing of the server response
		 	4: runs the query method again, with the same params, initial and pageLength 
		 		(now results may be different from the initial query, as the server may have
		 		added some new 'gap models')
		 */
		_requestByParams: function(params, options) {
			/**
			 * params: query parameters
			 * options: 
			 *	initial: initial item index
			 *	pageLength: 
			 *	(ajaxOptions) - removed.
			 */

			var defer = $.Deferred(),
				_this = this;

				// load the models that already were loaded and attend the query
			var loaded = this.query(params, options),
				// pluck the loaded model ids.
				loadedIds = _.pluck(loaded, 'id'),
				// check if there is a unique attribute in the params list
				unique = _.find(params, function(value, name) {
					return _.contains(_this.uniqueAttr, name);
				})

			// if:
			// 	1: in the params list there is a value that is listed in this.uniqueAttr
			//		AND
			// 	2: the list of loaded models has length equal to 1
			if (unique && loaded.length === 1) {
				defer.resolve(loaded[0]);
			} else {
				// otherwise do asynch request to the database.

				// fill the gaps:
				this._asynchRequest(loadedIds, params, options)
					// after gaps were filled, respond, by solving the defer.
					.then(function() {
						// do synch query again with the same parameters
						var results = _this.query(params, options),
							// if pageLength is 1, just return one model instead of array of models.
							results = (options.pageLength && options.pageLength === 1) ? results[0] : results;

					//	console.log('result ids: ' + _.pluck(results, 'id'));

						// resolve the defer.
						defer.resolve(results);
					});
				
			}

			return defer;
		},

		/**
		 * Asynch request
		 */
		_asynchRequest: function(loadedIds, params, options) {
			/**
			 * params: query parameters
			 * options: same as for _requestByParams
			 *	initial
			 *	pageLength
			 */

			loadedIds = loadedIds || [];

				// add the initial and length parameters to the request data.
			var metaData = {
					// array of ids to refuse (those ids from the models already loaded)
					loadedIds: loadedIds,

					initial: options.initial,
					pageLength: options.pageLength,
				},
				// the request parameters must have data about the 
				// request paging and loaded models
				// AND 
				// the parameters queried
				requestParams = _.extend(metaData, params),

				// cached request promise
				cached = this.cache(requestParams);


			if (cached) {
				console.log(JSON.stringify(requestParams));
				console.log('cached request')

				// return cached defer object.
				return cached;
			} else {

				console.log('request')

				/**
				 * before, we implemented the request by ourselves,
				 * so we had to parse and add the response.
				 * The new implementation uses Bakcbone built-in fetch functionality, with some special options.
				 */

				// send request
				var defer = $.Deferred(),
					// fetch options: Backbone.set options, jqXHR options
					fetchOptions = _.extend({ data: requestParams, remove: false }, this.ajaxOptions),
					// run query
					query = this.fetch(fetchOptions);

				// cache query.
				this.cache(requestParams, query);

				// return deferred object.
				return query;
			}
		},

		/**
		 * A more powerful 'where' method that invokes evaluateModel method.
		 */
		query: function(params, options) {
			/**
			 * params: query parameters
			 * options: initial, pageLength
			 */
			var _this = this,
				options = options || {},
				initial = options.initial,
				pageLength = options.pageLength,

				// filter models using the evaluateModel method.
				filtered = this.filter(function(model) {

					return _this.evaluateModel(model, params);
				});

			if (!_.isUndefined(initial) && !_.isUndefined(pageLength) ) {
				return _.chain(filtered)
						.rest(initial)
						.first(pageLength)
						.value();
			} else {
				return filtered;
			}
		},

		/**
		 * loop through the models properties
		 */
		evaluateModel: function(model, params) {
			var _this = this;

			return _.every(params, function(param, key) {
					// the param is param.
					// get the attr.
				var attr = model.get(key)
					// check if there is an attribute filter defined for the key
					attrFilter = _this.attrFilters[ key ];

				return (typeof attrFilter === 'function') ? attrFilter(attr, param, model) : attr == param;
			});
		},

		/**
		 * returns a filtered collection with reference to 'this' as the db.
		 */
		filtered: function(first, second) {
			var firstIsFunction = typeof first === 'function',
				options = firstIsFunction ? second : first,
				Constructor = firstIsFunction ? Filtered.extend(first.prototype).extend({
					initialize: function(models, options) {
						Filtered.prototype.initialize.call(this, models, options);
						first.prototype.initialize.call(this, models, options);
					}
				}) : Filtered;

			options.db = this;

			return new Constructor([], options);
		},
	});

	DB.Filtered = Filtered;

	return DB;
});