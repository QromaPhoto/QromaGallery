import {ProjectPath} from '../ProjectPath';
import * as fs from 'fs';
import * as path from 'path';
import {Config} from '../../common/config/private/Config';

export class Localizations {

  constructor() {
  }

  public static init(): void {
    const notLanguage = ['assets'];
    const dirCont = fs.readdirSync(ProjectPath.FrontendFolder)
      .filter((f): any => fs.statSync(path.join(ProjectPath.FrontendFolder, f)).isDirectory());
    Config.Client.languages = dirCont.filter((d): boolean => notLanguage.indexOf(d) === -1);
    Config.Client.languages.sort();
  }

}
