define(['backbone','jquery','underscore','_compare'], function(Backbone, $, undef, undef) {

	var DB = Backbone.DB = Backbone.Collection.extend({
		initialize: function(models, options) {
			options = options || {};
			this.initDb(options);
		},

		initDb: function(options) {

			_.bindAll(this, '_requestByParams','_asynchResponse','_asynchRequest');

			this.endpoint = options.endpoint || '';

			this.pageLength = options.pageLength || 10;

			this.ajaxOptions = options.ajaxOptions;



			/**
			 * object on which the loaded ids for a given data-set
			 * are stored
			 */
			this.loaded = {};


			/**
			 * Object where the attribute filters are stored.
			 * 
			 */
			this.attrFilters = {};
		},

		comparator: function(model) {
			return parseInt(model.get('id'));
		},

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

			var defer = $.Deferred();

			if (typeof params === 'object') {

				initial = !_.isUndefined(initial) ? initial : 0;
				pageLength = (pageLength && pageLength > 0) ? pageLength : this.pageLength;

				// transform pageLength into number
				initial = parseInt(initial);
				pageLength = parseInt(pageLength);

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
				loadedIds = _.pluck(loaded, 'id');

			// fill the gaps:
			this._asynchRequest(loadedIds, params, options)
				// after gaps were filled in, respond.
				.then(function() {
					// do synch query again with the same parameters
					var results = _this.query(params, options);

					console.log('result ids: ' + _.pluck(results, 'id'));

					// if there is only one result, remove it from wrapping array
					results = results.length === 1 ? results[0] : results;

					// resolve the defer.
					defer.resolve(results);
				});
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
				// build url
				url = this.url(requestParams),
				// run query
				query = $.ajax(url, this.ajaxOptions);

			// chain up for the asynch request.
			query
				.then(this._asynchResponse)
				.then(function(parsed) {


					console.log('loaded ids: ' + loadedIds);
					console.log('parsed: ' + _.pluck(parsed, 'id'))

					defer.resolve();
				});

			// return a deferred object.
			return defer;
		},

		/**
		 * Process _fillGap's response
		 */
		_asynchResponse: function(res) {
				// parse
			var parsed = this.parse(res);

			var beforeAdd = this.length;

			// add models to collection
			this.add(parsed);

			var addCount = this.length - beforeAdd;


			console.log('parsed length ' + parsed.length)
			console.log('added ' + addCount)


			return parsed;

			if (!parsed || parsed.length === 0 || parsed.length < pageLength) {
				/**
				 * Detect collection end: 
				 	This is a very crucial part of the application: 
				 	detect when the collection is finished.

				 	There are two possibilities: 
				 		1: the server returns NULL or an empty array
						2: the server returns a an array of models that is shorter
							than the requested page length
				 */

				// trigger 'collection-end'
				this.trigger('collection-end');

			} else if (pageLength <= addCount) {

				/**
				 * If the addCount supplied the pageLength requested,
				 * just synchronously query for the models and 
				 * solve the defer with them
				 */
		//		var models = this.query(params, initial, pageLength)
		//		defer.resolve(models);

			} else {

				console.log('added less than parsed!')

		//		this._requestByParams(defer, params, initial, pageLength + parsed.length - addCount);

				/**
				 * If the addcount was not enough
				 * try again with a higher pageLength
				 */

			}
		},



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

				return (typeof attrFilter === 'function') ? attrFilter(attr, param) : attr === param;
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
		url: function(params) {
			var jsonp = this.ajaxOptions.dataType === 'jsonp' ? '&callback=?' : '';

			return this.endpoint + '?' + $.param(params) + jsonp;
		},
	});

	return DB;
});