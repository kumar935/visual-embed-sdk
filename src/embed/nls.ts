/**
 * Copyright (c) 2022
 *
 * Embed ThoughtSpot NLS
 *
 * @summary Search embed
 * @author Kumar Animesh <animesh.kumar@thoughtspot.com>
 */

import { DOMSelector, Param, ViewConfig } from '../types';
import { getQueryParamString, checkReleaseVersionInBeta, getFilterQuery } from '../utils';
import { TsEmbed } from './ts-embed';
import { ERROR_MESSAGE } from '../errors';
import { getAuthPromise, getEmbedConfig } from './base';
import { getReleaseVersion } from '../auth';

/**
 * The configuration attributes for the embedded search view.
 *
 * @group Embed components
 */
export interface NLSViewConfig extends ViewConfig {
    /**
     * If set to false, eureka results are hidden
     */
    hideEurekaResults?: boolean;
}

/**
 * Embed ThoughtSpot search
 *
 * @group Embed components
 */
export class NLSEmbed extends TsEmbed {
    /**
     * The view configuration for the embedded ThoughtSpot search.
     */
    protected viewConfig: NLSViewConfig;

    constructor(domSelector: DOMSelector, viewConfig: NLSViewConfig) {
        super(domSelector);
        this.viewConfig = viewConfig;
    }

    protected getEmbedParams(): string {
        const { hideEurekaResults } = this.viewConfig;
        const queryParams = this.getBaseQueryParams();

        queryParams[Param.HideActions] = [...(queryParams[Param.HideActions] ?? [])];
        let query = '';
        const queryParamsString = getQueryParamString(queryParams, true);
        if (queryParamsString) {
            query = `?${queryParamsString}`;
        }
        return query;
    }

    private getIFrameSrc() {
        const path = 'insights/eureka';
        const tsPostHashParams = this.getThoughtSpotPostUrlParams();

        return `${this.getRootIframeSrc()}/embed/${path}${tsPostHashParams}`;
    }

    /**
     * Render the embedded ThoughtSpot NLS flow
     */
    public render(): NLSEmbed {
        super.render();

        const src = this.getIFrameSrc();
        this.renderIFrame(src);
        getAuthPromise().then(() => {
            if (
                checkReleaseVersionInBeta(
                    getReleaseVersion(),
                    getEmbedConfig().suppressSearchEmbedBetaWarning,
                )
            ) {
                alert(ERROR_MESSAGE.SEARCHEMBED_BETA_WRANING_MESSAGE);
            }
        });
        return this;
    }
}
