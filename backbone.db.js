define(['backbone','jquery','underscore','_compare'], function(Backbone, $, undef, undef) {

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

		//	this.url = options.url;

			this.pageLength = options.pageLength || 10;

			this.ajaxOptions = options.ajaxOptions;

			/**
			 * Unique attributes help accelerate data fetching by
			 * letting the Backbone DB instance know that if it can find one
			 * model with the uniqueAttr corresponding to the request params
			 * it can securely return the result without cheking with the server if there are
			 * no other possible results.
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
			this.attrFilters = _.extend({}, this.attrFilters, options.attrFilters);
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
			 * range: 
				- array: [initial, final],
				- number: initial (final is calculated through 'this.perPage')
				- function: evaluate it.
			 * ajaxOptions: opitons to be passed to $.ajax
			 */


			// normalize initial and pageLength
			initial = !_.isUndefined(initial) ? initial : 0;
			pageLength = (pageLength && pageLength > 0) ? pageLength : this.pageLength;
			// transform pageLength into number
			initial = parseInt(initial);
			pageLength = parseInt(pageLength);


			// the deferred object.
			var defer = $.Deferred();

			if (_.isArray(params)) {
				// multiple requests at once
				// run all three requests and return a unified defer.
				var _this = this,
					subRequests = _.map(params, function(p) {
						return _this.request(p, initial, pageLength);
					});


					console.log(subRequests);

				// wait for all subRequests to be done to solve the main defer.
				$.when.apply(null, subRequests)
					.then(function() {
							// arguments are sub request results
						var subResponses = Array.prototype.splice.call(arguments, 0),
							// merge all three request results into a single result
							response = _.union.apply(null, subResponses);

						// solve hte defer.
						defer.resolve(response);
					});

			} else if (typeof params === 'object') {

				this._requestByParams(defer, params, {
					initial: initial,
					pageLength: pageLength
				});

			} else if (typeof params === 'string' || typeof params === 'number') {

				this._requestById(defer, params);
			}

			// return the defer.
			return defer;
		},


		/**
		 * Tries to get a model by id (backbone collection.get(id))
		 * If unsuccessful, 
		 * Fetches a model by ID from the endpoint.
		 * It is actually a facade for _requestByParams
		 */
		_requestById: function(defer, id) {
			var model = this.get(id);

			if (model) {
				// wrap the model response in an array wrapper
				// so that it is consistent with the asynch response method.
				defer.resolve(model);
			} else {
				// _requestByParams(defer, params, options)
				this._requestByParams(
					defer, 
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
		_requestByParams: function(defer, params, options) {
			/**
			 * defer: the overall query defer to be responded to
			 * params: query parameters
			 * options: 
			 *	initial: initial item index
			 *	pageLength: 
			 *	(ajaxOptions) - removed.
			 */

			var _this = this;

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
			// otherwise do asynch request

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



			var defer = $.Deferred();

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
				// fetch options: Backbone.set options, jqXHR options
				fetchOptions = _.extend({ data: requestParams, remove: false }, this.ajaxOptions),
				// run query
				query = this.fetch(fetchOptions);

			/**
			 * before, we implemented the request by ourselves,
			 * so we had to parse and add the response.
			 * The new implementation uses Bakcbone built-in fetch functionality, with some special options.
			 */
				// build url
			//	url = this._dbUrl(requestParams),
			//	query = $.ajax(url, this.ajaxOptions);

			// chain up for the asynch request.
			query
			//	.then(this._asynchResponse)
				.then(function(parsed) {


				//	console.log('loaded ids: ' + loadedIds);
				//	console.log('parsed: ' + _.pluck(parsed, 'id'))

					defer.resolve();
				});

			// return a deferred object.
			return defer;
		},


		/**
		 * Process _fillGap's response
		 */
		/* NOT NEEDED anymore as we are using Backbone.Collection.fetch instead of 
		doing $.ajax
		_asynchResponse: function(res) {
				// parse
			var parsed = this.parse(res);

			var beforeAdd = this.length;

			// add models to collection
			this.add(parsed);

			var addCount = this.length - beforeAdd;


		//	console.log('parsed length ' + parsed.length)
		//	console.log('added ' + addCount)


			return parsed;
		},
		*/



		/**
		 * A more powerful 'where' method that invokes _evaluateModel method.
		 */
		query: function(params, options) {
			/**
			 * params: query parameters
			 * options: initial, pageLength
			 */
			var _this = this,
				initial = options.initial,
				pageLength = options.pageLength,

				// filter models using the _evaluateModel method.
				filtered = this.filter(function(model) {

					return _this._evaluateModel(model, params);
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
		_evaluateModel: function(model, params) {
			var _this = this;

			return _.every(params, function(param, key) {
					// the param is param.
					// get the attr.
				var attr = model.get(key)
					// check if there is an attribute filter defined for the key
					attrFilter = _this.attrFilters[ key ];

				return (typeof attrFilter === 'function') ? attrFilter(attr, param, _this) : attr == param;
			});
		},

		/**
		 * Defines a function to filter an attribute from a model.
		 */
		attrFilter: function(name, filter) {
			if (typeof name === 'string') {
				this.attrFilters[ name ] = filter;
			} else {
				var _this = this;
				_.each(name, function(filter, name) {
					_this.attrFilter(name, filter);
				});
			}

			return this;
		},

		/**
		 * Helper method that builds the url.
		 */
		 /* deprecated
		_dbUrl: function(params) {
			var jsonp = this.ajaxOptions.dataType === 'jsonp' ? '&callback=?' : '',
				endpoint = typeof this.url === 'function' ? this.url() : this.url;

			return endpoint + '?' + $.param(params) + jsonp;
		},
		*/
	});

	return DB;
});