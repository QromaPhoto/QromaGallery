import {AutoCompleteItem} from '../../../../common/entities/AutoCompleteItem';
import {SearchResultDTO} from '../../../../common/entities/SearchResultDTO';
import {SQLConnection} from './SQLConnection';
import {PhotoEntity} from './enitites/PhotoEntity';
import {DirectoryEntity} from './enitites/DirectoryEntity';
import {MediaEntity} from './enitites/MediaEntity';
import {PersonEntry} from './enitites/PersonEntry';
import {Brackets, SelectQueryBuilder, WhereExpression} from 'typeorm';
import {Config} from '../../../../common/config/private/Config';
import {
  ANDSearchQuery,
  DistanceSearch,
  FromDateSearch,
  MaxRatingSearch,
  MaxResolutionSearch,
  MinRatingSearch,
  MinResolutionSearch,
  OrientationSearch,
  ORSearchQuery,
  SearchListQuery,
  SearchQueryDTO,
  SearchQueryTypes,
  SomeOfSearchQuery,
  TextSearch,
  TextSearchQueryMatchTypes,
  ToDateSearch
} from '../../../../common/entities/SearchQueryDTO';
import {GalleryManager} from './GalleryManager';
import {ObjectManagers} from '../../ObjectManagers';
import {PhotoDTO} from '../../../../common/entities/PhotoDTO';
import {DatabaseType} from '../../../../common/config/private/PrivateConfig';
import {ISQLGalleryManager} from './IGalleryManager';
import {ISQLSearchManager} from './ISearchManager';
import {Utils} from '../../../../common/Utils';
import {FileEntity} from './enitites/FileEntity';
import {SQL_COLLATE} from './enitites/EntityUtils';

export class SearchManager implements ISQLSearchManager {

  // This trick enables us to list less rows as faces will be concatenated into one row
  // Also typeorm does not support automatic mapping of nested foreign keys
  // (i.e: leftJoinAndSelect('media.metadata.faces', 'faces')  does not work)
  private FACE_SELECT = Config.Server.Database.type === DatabaseType.mysql ?
    'CONCAT(\'[\' , GROUP_CONCAT(  \'{"name": "\' , person.name , \'", "box": {"top":\' , faces.box.top , \', "left":\' , faces.box.left , \', "height":\' , faces.box.height ,\', "width":\' , faces.box.width , \'}}\'  ) ,\']\') as media_metadataFaces' :
    '\'[\' || GROUP_CONCAT(  \'{"name": "\' || person.name || \'", "box": {"top":\' || faces.box.top || \', "left":\' || faces.box.left || \', "height":\' || faces.box.height ||\', "width":\' || faces.box.width || \'}}\'  ) ||\']\' as media_metadataFaces';
  private DIRECTORY_SELECT = ['directory.id', 'directory.name', 'directory.path'];

  private static autoCompleteItemsUnique(array: Array<AutoCompleteItem>): Array<AutoCompleteItem> {
    const a = array.concat();
    for (let i = 0; i < a.length; ++i) {
      for (let j = i + 1; j < a.length; ++j) {
        if (a[i].equals(a[j])) {
          a.splice(j--, 1);
        }
      }
    }

    return a;
  }

  async autocomplete(text: string, type: SearchQueryTypes): Promise<AutoCompleteItem[]> {

    const connection = await SQLConnection.getConnection();

    let result: AutoCompleteItem[] = [];
    const photoRepository = connection.getRepository(PhotoEntity);
    const mediaRepository = connection.getRepository(MediaEntity);
    const personRepository = connection.getRepository(PersonEntry);
    const directoryRepository = connection.getRepository(DirectoryEntity);


    if (type === SearchQueryTypes.any_text || type === SearchQueryTypes.keyword) {
      (await photoRepository
        .createQueryBuilder('photo')
        .select('DISTINCT(photo.metadata.keywords)')
        .where('photo.metadata.keywords LIKE :text COLLATE ' + SQL_COLLATE, {text: '%' + text + '%'})
        .limit(Config.Client.Search.AutoComplete.maxItemsPerCategory)
        .getRawMany())
        .map((r): Array<string> => (r.metadataKeywords as string).split(',') as Array<string>)
        .forEach((keywords): void => {
          result = result.concat(this.encapsulateAutoComplete(keywords
            .filter((k): boolean => k.toLowerCase().indexOf(text.toLowerCase()) !== -1), SearchQueryTypes.keyword));
        });
    }

    if (type === SearchQueryTypes.any_text || type === SearchQueryTypes.person) {
      result = result.concat(this.encapsulateAutoComplete((await personRepository
        .createQueryBuilder('person')
        .select('DISTINCT(person.name)')
        .where('person.name LIKE :text COLLATE ' + SQL_COLLATE, {text: '%' + text + '%'})
        .limit(Config.Client.Search.AutoComplete.maxItemsPerCategory)
        .orderBy('person.name')
        .getRawMany())
        .map(r => r.name), SearchQueryTypes.person));
    }

    if (type === SearchQueryTypes.any_text || type === SearchQueryTypes.position || type === SearchQueryTypes.distance) {
      (await photoRepository
        .createQueryBuilder('photo')
        .select('photo.metadata.positionData.country as country, ' +
          'photo.metadata.positionData.state as state, photo.metadata.positionData.city as city')
        .where('photo.metadata.positionData.country LIKE :text COLLATE ' + SQL_COLLATE, {text: '%' + text + '%'})
        .orWhere('photo.metadata.positionData.state LIKE :text COLLATE ' + SQL_COLLATE, {text: '%' + text + '%'})
        .orWhere('photo.metadata.positionData.city LIKE :text COLLATE ' + SQL_COLLATE, {text: '%' + text + '%'})
        .groupBy('photo.metadata.positionData.country, photo.metadata.positionData.state, photo.metadata.positionData.city')
        .limit(Config.Client.Search.AutoComplete.maxItemsPerCategory)
        .getRawMany())
        .filter((pm): boolean => !!pm)
        .map((pm): Array<string> => [pm.city || '', pm.country || '', pm.state || ''] as Array<string>)
        .forEach((positions): void => {
          result = result.concat(this.encapsulateAutoComplete(positions
              .filter((p): boolean => p.toLowerCase().indexOf(text.toLowerCase()) !== -1),
            type === SearchQueryTypes.distance ? type : SearchQueryTypes.position));
        });
    }

    if (type === SearchQueryTypes.any_text || type === SearchQueryTypes.file_name) {
      result = result.concat(this.encapsulateAutoComplete((await mediaRepository
        .createQueryBuilder('media')
        .select('DISTINCT(media.name)')
        .where('media.name LIKE :text COLLATE ' + SQL_COLLATE, {text: '%' + text + '%'})
        .limit(Config.Client.Search.AutoComplete.maxItemsPerCategory)
        .getRawMany())
        .map(r => r.name), SearchQueryTypes.file_name));
    }

    if (type === SearchQueryTypes.any_text || type === SearchQueryTypes.caption) {
      result = result.concat(this.encapsulateAutoComplete((await photoRepository
        .createQueryBuilder('media')
        .select('DISTINCT(media.metadata.caption) as caption')
        .where('media.metadata.caption LIKE :text COLLATE ' + SQL_COLLATE, {text: '%' + text + '%'})
        .limit(Config.Client.Search.AutoComplete.maxItemsPerCategory)
        .getRawMany())
        .map(r => r.caption), SearchQueryTypes.caption));
    }

    if (type === SearchQueryTypes.any_text || type === SearchQueryTypes.directory) {
      result = result.concat(this.encapsulateAutoComplete((await directoryRepository
        .createQueryBuilder('dir')
        .select('DISTINCT(dir.name)')
        .where('dir.name LIKE :text COLLATE ' + SQL_COLLATE, {text: '%' + text + '%'})
        .limit(Config.Client.Search.AutoComplete.maxItemsPerCategory)
        .getRawMany())
        .map(r => r.name), SearchQueryTypes.directory));
    }

    return SearchManager.autoCompleteItemsUnique(result);
  }

  async search(queryIN: SearchQueryDTO): Promise<SearchResultDTO> {
    const query = await this.prepareQuery(queryIN);
    const connection = await SQLConnection.getConnection();

    const result: SearchResultDTO = {
      searchQuery: queryIN,
      directories: [],
      media: [],
      metaFile: [],
      resultOverflow: false
    };


    const rawAndEntries = await connection
      .getRepository(MediaEntity)
      .createQueryBuilder('media')
      .select(['media', ...this.DIRECTORY_SELECT, this.FACE_SELECT])
      .where(this.buildWhereQuery(query))
      .leftJoin('media.directory', 'directory')
      .leftJoin('media.metadata.faces', 'faces')
      .leftJoin('faces.person', 'person')
      .limit(Config.Client.Search.maxMediaResult + 1)
      .groupBy('media.id')
      .getRawAndEntities();

    for (let i = 0; i < rawAndEntries.entities.length; ++i) {
      if (rawAndEntries.raw[i].media_metadataFaces) {
        rawAndEntries.entities[i].metadata.faces = JSON.parse(rawAndEntries.raw[i].media_metadataFaces);
      }
    }

    result.media = rawAndEntries.entities;

    if (result.media.length > Config.Client.Search.maxMediaResult) {
      result.resultOverflow = true;
    }

    if (Config.Client.Search.listMetafiles === true) {
      result.metaFile = await connection.getRepository(FileEntity)
        .createQueryBuilder('file')
        .select(['file', ...this.DIRECTORY_SELECT])
        .innerJoin(q => q.from(MediaEntity, 'media')
            .select('distinct directory.id')
            .where(this.buildWhereQuery(query))
            .leftJoin('media.directory', 'directory'),
          'dir',
          'file.directory=dir.id')
        .leftJoin('file.directory', 'directory')
        .getMany();
    }

    if (Config.Client.Search.listDirectories === true) {
      const dirQuery = this.filterDirectoryQuery(query);
      if (dirQuery !== null) {
        result.directories = await connection
          .getRepository(DirectoryEntity)
          .createQueryBuilder('directory')
          .where(this.buildWhereQuery(dirQuery, true))
          .limit(Config.Client.Search.maxDirectoryResult + 1)
          .getMany();

        // setting previews
        if (result.directories) {
          for (const item of result.directories) {
            await (ObjectManagers.getInstance().GalleryManager as ISQLGalleryManager)
              .fillPreviewForSubDir(connection, item as DirectoryEntity);
          }
        }
        if (result.directories.length > Config.Client.Search.maxDirectoryResult) {
          result.resultOverflow = true;
        }
      }
    }

    return result;
  }

  public async getRandomPhoto(query: SearchQueryDTO): Promise<PhotoDTO> {
    const connection = await SQLConnection.getConnection();
    const sqlQuery: SelectQueryBuilder<PhotoEntity> = connection
      .getRepository(PhotoEntity)
      .createQueryBuilder('media')
      .select(['media', ...this.DIRECTORY_SELECT])
      .innerJoin('media.directory', 'directory')
      .where(await this.prepareAndBuildWhereQuery(query));


    if (Config.Server.Database.type === DatabaseType.mysql) {
      return await sqlQuery.groupBy('RAND(), media.id').limit(1).getOne();
    }
    return await sqlQuery.groupBy('RANDOM()').limit(1).getOne();

  }


  public async getCount(query: SearchQueryDTO): Promise<number> {
    const connection = await SQLConnection.getConnection();

    return await connection
      .getRepository(MediaEntity)
      .createQueryBuilder('media')
      .innerJoin('media.directory', 'directory')
      .where(await this.prepareAndBuildWhereQuery(query))
      .getCount();
  }

  public async prepareAndBuildWhereQuery(queryIN: SearchQueryDTO, directoryOnly = false): Promise<Brackets> {
    const query = await this.prepareQuery(queryIN);
    return this.buildWhereQuery(query, directoryOnly);
  }

  public async prepareQuery(queryIN: SearchQueryDTO): Promise<SearchQueryDTO> {
    let query: SearchQueryDTO = this.assignQueryIDs(Utils.clone(queryIN)); // assign local ids before flattening SOME_OF queries
    query = this.flattenSameOfQueries(query);
    query = await this.getGPSData(query);
    return query;
  }

  /**
   * Builds the SQL Where query from search query
   * @param query input search query
   * @param directoryOnly Only builds directory related queries
   * @private
   */
  public buildWhereQuery(query: SearchQueryDTO, directoryOnly = false): Brackets {
    const queryId = (query as SearchQueryDTOWithID).queryId;
    switch (query.type) {
      case SearchQueryTypes.AND:
        return new Brackets((q): any => {
          (query as ANDSearchQuery).list.forEach((sq): any => q.andWhere(this.buildWhereQuery(sq, directoryOnly)));
          return q;
        });
      case SearchQueryTypes.OR:
        return new Brackets((q): any => {
          (query as ANDSearchQuery).list.forEach((sq): any => q.orWhere(this.buildWhereQuery(sq, directoryOnly)));
          return q;
        });


      case SearchQueryTypes.distance:
        if (directoryOnly) {
          throw new Error('not supported in directoryOnly mode');
        }
        /**
         * This is a best effort calculation, not fully accurate in order to have higher performance.
         * see: https://stackoverflow.com/a/50506609
         */
        const earth = 6378.137;  // radius of the earth in kilometer
        const latDelta = (1 / ((2 * Math.PI / 360) * earth));  // 1 km in degree
        const lonDelta = (1 / ((2 * Math.PI / 360) * earth));  // 1 km in degree

        // TODO: properly handle latitude / longitude boundaries
        const trimRange = (value: number, min: number, max: number): number => {
          return Math.min(Math.max(value, min), max);
        };

        const minLat = trimRange((query as DistanceSearch).from.GPSData.latitude -
          ((query as DistanceSearch).distance * latDelta), -90, 90);
        const maxLat = trimRange((query as DistanceSearch).from.GPSData.latitude +
          ((query as DistanceSearch).distance * latDelta), -90, 90);
        const minLon = trimRange((query as DistanceSearch).from.GPSData.longitude -
          ((query as DistanceSearch).distance * lonDelta) / Math.cos(minLat * (Math.PI / 180)), -180, 180);
        const maxLon = trimRange((query as DistanceSearch).from.GPSData.longitude +
          ((query as DistanceSearch).distance * lonDelta) / Math.cos(maxLat * (Math.PI / 180)), -180, 180);


        return new Brackets((q): any => {
          const textParam: any = {};
          textParam['maxLat' + queryId] = maxLat;
          textParam['minLat' + queryId] = minLat;
          textParam['maxLon' + queryId] = maxLon;
          textParam['minLon' + queryId] = minLon;
          if (!(query as DistanceSearch).negate) {
            q.where(`media.metadata.positionData.GPSData.latitude < :maxLat${queryId}`, textParam);
            q.andWhere(`media.metadata.positionData.GPSData.latitude > :minLat${queryId}`, textParam);
            q.andWhere(`media.metadata.positionData.GPSData.longitude < :maxLon${queryId}`, textParam);
            q.andWhere(`media.metadata.positionData.GPSData.longitude > :minLon${queryId}`, textParam);
          } else {
            q.where(`media.metadata.positionData.GPSData.latitude > :maxLat${queryId}`, textParam);
            q.orWhere(`media.metadata.positionData.GPSData.latitude < :minLat${queryId}`, textParam);
            q.orWhere(`media.metadata.positionData.GPSData.longitude > :maxLon${queryId}`, textParam);
            q.orWhere(`media.metadata.positionData.GPSData.longitude < :minLon${queryId}`, textParam);
          }
          return q;
        });

      case SearchQueryTypes.from_date:
        if (directoryOnly) {
          throw new Error('not supported in directoryOnly mode');
        }
        return new Brackets((q): any => {
          if (typeof (query as FromDateSearch).value === 'undefined') {
            throw new Error('Invalid search query: Date Query should contain from value');
          }
          const relation = (query as TextSearch).negate ? '<' : '>=';

          const textParam: any = {};
          textParam['from' + queryId] = (query as FromDateSearch).value;
          q.where(`media.metadata.creationDate ${relation} :from${queryId}`, textParam);

          return q;
        });

      case SearchQueryTypes.to_date:
        if (directoryOnly) {
          throw new Error('not supported in directoryOnly mode');
        }
        return new Brackets((q): any => {
          if (typeof (query as ToDateSearch).value === 'undefined') {
            throw new Error('Invalid search query: Date Query should contain to value');
          }
          const relation = (query as TextSearch).negate ? '>' : '<=';

          const textParam: any = {};
          textParam['to' + queryId] = (query as ToDateSearch).value;
          q.where(`media.metadata.creationDate ${relation} :to${queryId}`, textParam);

          return q;
        });

      case SearchQueryTypes.min_rating:
        if (directoryOnly) {
          throw new Error('not supported in directoryOnly mode');
        }
        return new Brackets((q): any => {
          if (typeof (query as MinRatingSearch).value === 'undefined') {
            throw new Error('Invalid search query: Rating Query should contain minvalue');
          }

          const relation = (query as TextSearch).negate ? '<' : '>=';

          const textParam: any = {};
          textParam['min' + queryId] = (query as MinRatingSearch).value;
          q.where(`media.metadata.rating ${relation}  :min${queryId}`, textParam);

          return q;
        });
      case SearchQueryTypes.max_rating:
        if (directoryOnly) {
          throw new Error('not supported in directoryOnly mode');
        }
        return new Brackets((q): any => {
          if (typeof (query as MaxRatingSearch).value === 'undefined') {
            throw new Error('Invalid search query: Rating Query should contain  max value');
          }

          const relation = (query as TextSearch).negate ? '>' : '<=';

          if (typeof (query as MaxRatingSearch).value !== 'undefined') {
            const textParam: any = {};
            textParam['max' + queryId] = (query as MaxRatingSearch).value;
            q.where(`media.metadata.rating ${relation}  :max${queryId}`, textParam);
          }
          return q;
        });

      case SearchQueryTypes.min_resolution:
        if (directoryOnly) {
          throw new Error('not supported in directoryOnly mode');
        }
        return new Brackets((q): any => {
          if (typeof (query as MinResolutionSearch).value === 'undefined') {
            throw new Error('Invalid search query: Resolution Query should contain min value');
          }

          const relation = (query as TextSearch).negate ? '<' : '>=';

          const textParam: any = {};
          textParam['min' + queryId] = (query as MinResolutionSearch).value * 1000 * 1000;
          q.where(`media.metadata.size.width * media.metadata.size.height ${relation} :min${queryId}`, textParam);


          return q;
        });

      case SearchQueryTypes.max_resolution:
        if (directoryOnly) {
          throw new Error('not supported in directoryOnly mode');
        }
        return new Brackets((q): any => {
          if (typeof (query as MaxResolutionSearch).value === 'undefined') {
            throw new Error('Invalid search query: Rating Query should contain min or max value');
          }

          const relation = (query as TextSearch).negate ? '>' : '<=';

          const textParam: any = {};
          textParam['max' + queryId] = (query as MaxResolutionSearch).value * 1000 * 1000;
          q.where(`media.metadata.size.width * media.metadata.size.height ${relation} :max${queryId}`, textParam);

          return q;
        });

      case SearchQueryTypes.orientation:
        if (directoryOnly) {
          throw new Error('not supported in directoryOnly mode');
        }
        return new Brackets((q): any => {
          if ((query as OrientationSearch).landscape) {
            q.where('media.metadata.size.width >= media.metadata.size.height');
          } else {
            q.where('media.metadata.size.width <= media.metadata.size.height');
          }
          return q;
        });


      case SearchQueryTypes.SOME_OF:
        throw new Error('Some of not supported');

    }

    return new Brackets((q: WhereExpression) => {

      const createMatchString = (str: string): string => {
        if ((query as TextSearch).matchType === TextSearchQueryMatchTypes.exact_match) {
          return str;
        }
        // MySQL uses C escape syntax in strings, details:
        // https://stackoverflow.com/questions/14926386/how-to-search-for-slash-in-mysql-and-why-escaping-not-required-for-wher
        if (Config.Server.Database.type === DatabaseType.mysql) {
          /// this reqExp replaces the "\\" to "\\\\\"
          return '%' + str.replace(new RegExp('\\\\', 'g'), '\\\\') + '%';
        }
        return `%${str}%`;
      };

      const LIKE = (query as TextSearch).negate ? 'NOT LIKE' : 'LIKE';
      // if the expression is negated, we use AND instead of OR as nowhere should that match
      const whereFN = (query as TextSearch).negate ? 'andWhere' : 'orWhere';
      const whereFNRev = (query as TextSearch).negate ? 'orWhere' : 'andWhere';

      const textParam: any = {};
      textParam['text' + queryId] = createMatchString((query as TextSearch).text);

      if (query.type === SearchQueryTypes.any_text ||
        query.type === SearchQueryTypes.directory) {
        const dirPathStr = ((query as TextSearch).text).replace(new RegExp('\\\\', 'g'), '/');


        textParam['fullPath' + queryId] = createMatchString(dirPathStr);
        q[whereFN](`directory.path ${LIKE} :fullPath${queryId} COLLATE ` + SQL_COLLATE,
          textParam);

        const directoryPath = GalleryManager.parseRelativeDirePath(dirPathStr);
        q[whereFN](new Brackets((dq): any => {
          textParam['dirName' + queryId] = createMatchString(directoryPath.name);
          dq[whereFNRev](`directory.name ${LIKE} :dirName${queryId} COLLATE ${SQL_COLLATE}`,
            textParam);
          if (dirPathStr.includes('/')) {
            textParam['parentName' + queryId] = createMatchString(directoryPath.parent);
            dq[whereFNRev](`directory.path ${LIKE} :parentName${queryId} COLLATE ${SQL_COLLATE}`,
              textParam);
          }
          return dq;
        }));
      }

      if ((query.type === SearchQueryTypes.any_text && !directoryOnly) || query.type === SearchQueryTypes.file_name) {
        q[whereFN](`media.name ${LIKE} :text${queryId} COLLATE ${SQL_COLLATE}`,
          textParam);
      }

      if ((query.type === SearchQueryTypes.any_text && !directoryOnly) || query.type === SearchQueryTypes.caption) {
        q[whereFN](`media.metadata.caption ${LIKE} :text${queryId} COLLATE ${SQL_COLLATE}`,
          textParam);
      }

      if ((query.type === SearchQueryTypes.any_text && !directoryOnly) || query.type === SearchQueryTypes.position) {
        q[whereFN](`media.metadata.positionData.country ${LIKE} :text${queryId} COLLATE ${SQL_COLLATE}`,
          textParam)
          [whereFN](`media.metadata.positionData.state ${LIKE} :text${queryId} COLLATE ${SQL_COLLATE}`,
          textParam)
          [whereFN](`media.metadata.positionData.city ${LIKE} :text${queryId} COLLATE ${SQL_COLLATE}`,
          textParam);
      }

      // Matching for array type fields
      const matchArrayField = (fieldName: string): void => {
        q[whereFN](new Brackets((qbr): void => {
          if ((query as TextSearch).matchType !== TextSearchQueryMatchTypes.exact_match) {
            qbr[whereFN](`${fieldName} ${LIKE} :text${queryId} COLLATE ${SQL_COLLATE}`,
              textParam);
          } else {
            qbr[whereFN](new Brackets((qb): void => {
              textParam['CtextC' + queryId] = `%,${(query as TextSearch).text},%`;
              textParam['Ctext' + queryId] = `%,${(query as TextSearch).text}`;
              textParam['textC' + queryId] = `${(query as TextSearch).text},%`;
              textParam['text_exact' + queryId] = `${(query as TextSearch).text}`;

              qb[whereFN](`${fieldName} ${LIKE} :CtextC${queryId} COLLATE ${SQL_COLLATE}`,
                textParam);
              qb[whereFN](`${fieldName} ${LIKE} :Ctext${queryId} COLLATE ${SQL_COLLATE}`,
                textParam);
              qb[whereFN](`${fieldName} ${LIKE} :textC${queryId} COLLATE ${SQL_COLLATE}`,
                textParam);
              qb[whereFN](`${fieldName} ${LIKE} :text_exact${queryId} COLLATE ${SQL_COLLATE}`,
                textParam);
            }));
          }
          if ((query as TextSearch).negate) {
            qbr.orWhere(`${fieldName} IS NULL`);
          }
        }));
      };


      if ((query.type === SearchQueryTypes.any_text && !directoryOnly) || query.type === SearchQueryTypes.person) {
        matchArrayField('media.metadata.persons');
      }

      if ((query.type === SearchQueryTypes.any_text && !directoryOnly) || query.type === SearchQueryTypes.keyword) {
        matchArrayField('media.metadata.keywords');
      }
      return q;
    });
  }

  protected flattenSameOfQueries(query: SearchQueryDTO): SearchQueryDTO {
    switch (query.type) {
      case SearchQueryTypes.AND:
      case SearchQueryTypes.OR:
        return {
          type: query.type,
          list: (query as SearchListQuery).list.map((q): SearchQueryDTO => this.flattenSameOfQueries(q))
        } as SearchListQuery;
      case SearchQueryTypes.SOME_OF:
        const someOfQ = query as SomeOfSearchQuery;
        someOfQ.min = someOfQ.min || 1;

        if (someOfQ.min === 1) {
          return this.flattenSameOfQueries({
            type: SearchQueryTypes.OR,
            list: (someOfQ as SearchListQuery).list
          } as ORSearchQuery);
        }

        if (someOfQ.min === (query as SearchListQuery).list.length) {
          return this.flattenSameOfQueries({
            type: SearchQueryTypes.AND,
            list: (someOfQ as SearchListQuery).list
          } as ANDSearchQuery);
        }

        const getAllCombinations = (num: number, arr: SearchQueryDTO[], start = 0): SearchQueryDTO[] => {
          if (num <= 0 || num > arr.length || start >= arr.length) {
            return null;
          }
          if (num <= 1) {
            return arr.slice(start);
          }
          if (num === arr.length - start) {
            return [{
              type: SearchQueryTypes.AND,
              list: arr.slice(start)
            } as ANDSearchQuery];
          }
          const ret: ANDSearchQuery[] = [];
          for (let i = start; i < arr.length; ++i) {
            const subRes = getAllCombinations(num - 1, arr, i + 1);
            if (subRes === null) {
              break;
            }
            const and: ANDSearchQuery = {
              type: SearchQueryTypes.AND,
              list: [
                arr[i]
              ]
            };
            if (subRes.length === 1) {
              if (subRes[0].type === SearchQueryTypes.AND) {
                and.list.push(...(subRes[0] as ANDSearchQuery).list);
              } else {
                and.list.push(subRes[0]);
              }
            } else {
              and.list.push({
                type: SearchQueryTypes.OR,
                list: subRes
              } as ORSearchQuery);
            }
            ret.push(and);

          }

          if (ret.length === 0) {
            return null;
          }
          return ret;
        };


        return this.flattenSameOfQueries({
          type: SearchQueryTypes.OR,
          list: getAllCombinations(someOfQ.min, (query as SearchListQuery).list)
        } as ORSearchQuery);

    }
    return query;
  }

  /**
   * Assigning IDs to search queries. It is a help / simplification to typeorm,
   * so less parameters are needed to pass down to SQL.
   * Witch SOME_OF query the number of WHERE constrains have O(N!) complexity
   */
  private assignQueryIDs(queryIN: SearchQueryDTO, id = {value: 1}): SearchQueryDTO {
    if ((queryIN as SearchListQuery).list) {
      (queryIN as SearchListQuery).list.forEach(q => this.assignQueryIDs(q, id));
      return queryIN;
    }
    (queryIN as SearchQueryDTOWithID).queryId = id.value;
    id.value++;
    return queryIN;
  }

  /**
   * Returns only those part of a query tree that only contains directory related search queries
   */
  private filterDirectoryQuery(query: SearchQueryDTO): SearchQueryDTO {
    switch (query.type) {
      case SearchQueryTypes.AND:
        const andRet = {
          type: SearchQueryTypes.AND,
          list: (query as SearchListQuery).list.map(q => this.filterDirectoryQuery(q))
        } as ANDSearchQuery;
        // if any of the queries contain non dir query thw whole and query is a non dir query
        if (andRet.list.indexOf(null) !== -1) {
          return null;
        }
        return andRet;

      case SearchQueryTypes.OR:
        const orRet = {
          type: SearchQueryTypes.OR,
          list: (query as SearchListQuery).list.map(q => this.filterDirectoryQuery(q)).filter(q => q !== null)
        } as ORSearchQuery;
        if (orRet.list.length === 0) {
          return null;
        }
        return orRet;

      case SearchQueryTypes.any_text:
      case SearchQueryTypes.directory:
        return query;

      case SearchQueryTypes.SOME_OF:
        throw new Error('"Some of" queries should have been already flattened');
    }
    // of none of the above, its not a directory search
    return null;
  }

  private async getGPSData(query: SearchQueryDTO): Promise<SearchQueryDTO> {
    if ((query as ANDSearchQuery | ORSearchQuery).list) {
      for (let i = 0; i < (query as ANDSearchQuery | ORSearchQuery).list.length; ++i) {
        (query as ANDSearchQuery | ORSearchQuery).list[i] =
          await this.getGPSData((query as ANDSearchQuery | ORSearchQuery).list[i]);
      }
    }
    if (query.type === SearchQueryTypes.distance && (query as DistanceSearch).from.text) {
      (query as DistanceSearch).from.GPSData =
        await ObjectManagers.getInstance().LocationManager.getGPSData((query as DistanceSearch).from.text);
    }
    return query;
  }

  private encapsulateAutoComplete(values: string[], type: SearchQueryTypes): Array<AutoCompleteItem> {
    const res: AutoCompleteItem[] = [];
    values.forEach((value): void => {
      res.push(new AutoCompleteItem(value, type));
    });
    return res;
  }


}

export interface SearchQueryDTOWithID extends SearchQueryDTO {
  queryId: number;
}
