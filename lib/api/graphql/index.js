'use strict';

const { makeExecutableSchema } = require('graphql-tools');
const { KuzzleGraphql } = require('./kuzzle-graphql');
const { graphql } = require('graphql');
const Request = require('kuzzle-common-objects').Request;

/**
 * @class KuzzleGraphQL
 * @property endpoint
 * @param {Kuzzle} kuzzle
 */
class GraphQLEndpoint {
  constructor(kuzzle, schemaConfig = {}) {
    this.kuzzle = kuzzle;
    this.config = schemaConfig;
    this.schema = null;
    this.generateLoaders = null;
    this.kuzzleGql = new KuzzleGraphql(schemaConfig);
  }

  async init() {
    const types = {};
    for (const indexName of Object.keys(this.config)) {
      const collections = this.config[indexName];

      for (const collectionName of Object.keys(collections)) {
        const typeConf = collections[collectionName];
        const request = new Request({
          action: 'getMapping',
          collection: collectionName,
          controller: 'collection',
          index: indexName,
        });

        try {
          const response = await this.kuzzle.funnel.processRequest(request);
          if (response.status === 404) {
            return;
            // TODO log
          }
          types[typeConf.typeName] = this.kuzzleGql.generateType(indexName, collectionName, response.result);
        } catch (error) {
          return;
          // TODO
        }
      }
    }
    const typeDefs = this.kuzzleGql.generateSchemaFromTypes(types);
    const resolvers = this.kuzzleGql.generateResolverMap();
    this.generateLoaders = this.kuzzleGql.generateLoaderCreator(this.kuzzle);

    this.schema = makeExecutableSchema({
      resolverValidationOptions: {
        requireResolversForArgs: true,
        requireResolversForNonScalar: true,
      },
      resolvers,
      typeDefs
    });
  }

  endpoint(request, cb) {
    this.kuzzle.funnel.throttle((r) => {
      const body = r.input.body || {};
      const query = body.query || {};
      const vars = body.variables || {};
      const context = {
        loaders: this.generateLoaders()
      };
      graphql(this.schema, query, null, context, vars).then(graphqlResult => {
        r.setResult(graphqlResult, {
          headers: { 'content-type': 'application/json' },
          raw: true,
          status: 200
        });
        cb(r);
      });
    }, this, request);
  }
}

module.exports = GraphQLEndpoint;