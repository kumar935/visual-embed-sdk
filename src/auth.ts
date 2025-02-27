import EventEmitter from 'eventemitter3';
import _ from 'lodash';
import { initMixpanel } from './mixpanel-service';
import {
    AuthType, DOMSelector, EmbedConfig, EmbedEvent, Param,
} from './types';
import { getDOMNode, getRedirectUrl } from './utils';
// eslint-disable-next-line import/no-cycle
import {
    fetchSessionInfoService,
    fetchAuthTokenService,
    fetchAuthService,
    fetchBasicAuthService,
    fetchLogoutService,
    fetchAuthPostService,
} from './utils/authService';

// eslint-disable-next-line import/no-mutable-exports
export let loggedInStatus = false;
// eslint-disable-next-line import/no-mutable-exports
export let samlAuthWindow: Window = null;
// eslint-disable-next-line import/no-mutable-exports
export let samlCompletionPromise: Promise<void> = null;
let sessionInfo: sessionInfoInterface = null;
let sessionInfoResolver: (value: sessionInfoInterface) => void = null;
const sessionInfoPromise = new Promise((resolve:(value: sessionInfoInterface) => void) => {
    sessionInfoResolver = resolve;
});
let releaseVersion = '';

export const SSO_REDIRECTION_MARKER_GUID = '5e16222e-ef02-43e9-9fbd-24226bf3ce5b';

export const EndPoints = {
    AUTH_VERIFICATION: '/callosum/v1/session/info',
    SAML_LOGIN_TEMPLATE: (targetUrl: string) => `/callosum/v1/saml/login?targetURLPath=${targetUrl}`,
    OIDC_LOGIN_TEMPLATE: (targetUrl: string) => `/callosum/v1/oidc/login?targetURLPath=${targetUrl}`,
    TOKEN_LOGIN: '/callosum/v1/session/login/token',
    BASIC_LOGIN: '/callosum/v1/session/login',
    LOGOUT: '/callosum/v1/session/logout',
};

interface sessionInfoInterface {
    userGUID: any;
    isPublicUser: any;
    mixpanelToken: any;
    [key:string]:any;
}

/**
 * Enum for auth failure types. This is the parameter passed to the listner
 * of {@link AuthStatus.FAILURE}.
 *
 * @group Authentication / Init
 */
export enum AuthFailureType {
    SDK = 'SDK',
    NO_COOKIE_ACCESS = 'NO_COOKIE_ACCESS',
    EXPIRY = 'EXPIRY',
    OTHER = 'OTHER',
}

/**
 * Enum for auth status emitted by the emitter returned from {@link init}.
 *
 * @group Authentication / Init
 */
export enum AuthStatus {
    /**
     * Emits when the SDK fails to authenticate
     */
    FAILURE = 'FAILURE',
    /**
     * Emits when the SDK authenticates successfully
     */
    SDK_SUCCESS = 'SDK_SUCCESS',
    /**
     * Emits when the app sends an authentication success message
     */
    SUCCESS = 'SUCCESS',
    /**
     * Emits when a user logs out
     */
    LOGOUT = 'LOGOUT',
    /**
     * Emitted when inPopup: true in the SAMLRedirect flow.
     * And, we are waiting for popup to be triggered either programatically
     * or by the trigger button.
     *
     * @version SDK: 1.19.0
     */
    WAITING_FOR_POPUP = 'WAITING_FOR_POPUP',
}

/**
 * Event emitter returned from {@link init}.
 *
 * @group Authentication / Init
 */
export interface AuthEventEmitter {
    /**
     * Register a listener on Auth failure.
     *
     * @param event
     * @param listener
     */
    on(event: AuthStatus.FAILURE, listener: (failureType: AuthFailureType) => void): this;
    /**
     * Register a listener on Auth SDK success.
     *
     * @param event
     * @param listener
     */
    on(
        event: AuthStatus.SDK_SUCCESS | AuthStatus.LOGOUT | AuthStatus.WAITING_FOR_POPUP,
        listener: () => void,
    ): this;
    on(event: AuthStatus.SUCCESS, listener: (sessionInfo: any) => void): this;
    once(event: AuthStatus.FAILURE, listener: (failureType: AuthFailureType) => void): this;
    once(
        event: AuthStatus.SDK_SUCCESS | AuthStatus.LOGOUT | AuthStatus.WAITING_FOR_POPUP,
        listener: () => void,
    ): this;
    once(event: AuthStatus.SUCCESS, listener: (sessionInfo: any) => void): this;
    /**
     * Trigger an event on the emitter returned from init.
     *
     * @param {@link AuthEvent}
     */
    emit(event: AuthEvent): void;
}

/**
 * Events which can be triggered on the emitter returned from {@link init}.
 *
 * @group Authentication / Init
 */
export enum AuthEvent {
    /**
     * Manually trigger the SSO popup. This is useful with
     * authStatus: SAMLRedirect/OIDCRedicre and inPopup: true
     */
    TRIGGER_SSO_POPUP = 'TRIGGER_SSO_POPUP',
}

let authEE: EventEmitter<AuthStatus | AuthEvent>;

/**
 *
 */
export function getAuthEE(): EventEmitter<AuthStatus | AuthEvent> {
    return authEE;
}

/**
 *
 * @param eventEmitter
 */
export function setAuthEE(eventEmitter: EventEmitter<AuthStatus | AuthEvent>): void {
    authEE = eventEmitter;
}

/**
 *
 */
export function notifyAuthSDKSuccess(): void {
    if (!authEE) {
        console.error('SDK not initialized');
        return;
    }
    authEE.emit(AuthStatus.SDK_SUCCESS);
}

/**
 *
 */
export function notifyAuthSuccess(): void {
    if (!authEE) {
        console.error('SDK not initialized');
        return;
    }
    authEE.emit(AuthStatus.SUCCESS, sessionInfo);
}

/**
 *
 * @param failureType
 */
export function notifyAuthFailure(failureType: AuthFailureType): void {
    if (!authEE) {
        console.error('SDK not initialized');
        return;
    }
    authEE.emit(AuthStatus.FAILURE, failureType);
}

/**
 *
 */
export function notifyLogout(): void {
    if (!authEE) {
        console.error('SDK not initialized');
        return;
    }
    authEE.emit(AuthStatus.LOGOUT);
}

export const initSession = (sessionDetails: sessionInfoInterface) => {
    if (_.isNull(sessionInfo)) {
        sessionInfo = sessionDetails;
        initMixpanel(sessionInfo);
        sessionInfoResolver(sessionInfo);
    }
};

export const getSessionDetails = (sessionInfoResp: any):sessionInfoInterface => {
    const devMixpanelToken = sessionInfoResp.configInfo.mixpanelConfig.devSdkKey;
    const prodMixpanelToken = sessionInfoResp.configInfo.mixpanelConfig.prodSdkKey;
    const mixpanelToken = sessionInfoResp.configInfo.mixpanelConfig.production
        ? prodMixpanelToken
        : devMixpanelToken;
    return {
        userGUID: sessionInfoResp.userGUID,
        mixpanelToken,
        isPublicUser: sessionInfoResp.configInfo.isPublicUser,
        ...sessionInfoResp,
    };
};

/**
 * Check if we are logged into the ThoughtSpot cluster
 *
 * @param thoughtSpotHost The ThoughtSpot cluster hostname or IP
 */
async function isLoggedIn(thoughtSpotHost: string): Promise<boolean> {
    const authVerificationUrl = `${thoughtSpotHost}${EndPoints.AUTH_VERIFICATION}`;
    let response = null;
    try {
        response = await fetchSessionInfoService(authVerificationUrl);
        const sessionInfoResp = await response.json();
        const sessionDetails = getSessionDetails(sessionInfoResp);
        // Store user session details from session info
        initSession(sessionDetails);
        releaseVersion = sessionInfoResp.releaseVersion;
    } catch (e) {
        return false;
    }
    return response.status === 200;
}

/**
 * Return releaseVersion if available
 */
export function getReleaseVersion() {
    return releaseVersion;
}

/**
 * Return a promise that resolves with the session information when
 * authentication is successful. And info is available.
 *
 * @group Global methods
 */
export function getSessionInfo(): Promise<sessionInfoInterface> {
    return sessionInfoPromise;
}

const DUPLICATE_TOKEN_ERR = 'Duplicate token, please issue a new token every time getAuthToken callback is called.'
    + 'See https://developers.thoughtspot.com/docs/?pageid=embed-auth#trusted-auth-embed for more details.';
let prevAuthToken: string = null;
/**
 *
 * @param authtoken
 */
function alertForDuplicateToken(authtoken: string) {
    if (prevAuthToken === authtoken) {
        // eslint-disable-next-line no-alert
        alert(DUPLICATE_TOKEN_ERR);
        throw new Error(DUPLICATE_TOKEN_ERR);
    }
    prevAuthToken = authtoken;
}

/**
 * Check if we are stuck at the SSO redirect URL
 */
function isAtSSORedirectUrl(): boolean {
    return window.location.href.indexOf(SSO_REDIRECTION_MARKER_GUID) >= 0;
}

/**
 * Remove the SSO redirect URL marker
 */
function removeSSORedirectUrlMarker(): void {
    // Note (sunny): This will leave a # around even if it was not in the URL
    // to begin with. Trying to remove the hash by changing window.location will
    // reload the page which we don't want. We'll live with adding an
    // unnecessary hash to the parent page URL until we find any use case where
    // that creates an issue.
    window.location.hash = window.location.hash.replace(SSO_REDIRECTION_MARKER_GUID, '');
}

export const getAuthenticaionToken = async (embedConfig: EmbedConfig): Promise<any> => {
    const { authEndpoint, getAuthToken } = embedConfig;
    let authToken = null;
    if (getAuthToken) {
        authToken = await getAuthToken();
        alertForDuplicateToken(authToken);
    } else {
        const response = await fetchAuthTokenService(authEndpoint);
        authToken = await response.text();
    }
    return authToken;
};

/**
 * Perform token based authentication
 *
 * @param embedConfig The embed configuration
 */
export const doTokenAuth = async (embedConfig: EmbedConfig): Promise<boolean> => {
    const {
        thoughtSpotHost, username, authEndpoint, getAuthToken,
    } = embedConfig;
    if (!authEndpoint && !getAuthToken) {
        throw new Error('Either auth endpoint or getAuthToken function must be provided');
    }
    loggedInStatus = await isLoggedIn(thoughtSpotHost);
    if (!loggedInStatus) {
        const authToken = await getAuthenticaionToken(embedConfig);
        let resp;
        try {
            resp = await fetchAuthPostService(thoughtSpotHost, username, authToken);
        } catch (e) {
            resp = await fetchAuthService(thoughtSpotHost, username, authToken);
        }
        // token login issues a 302 when successful
        loggedInStatus = resp.ok || resp.type === 'opaqueredirect';
        if (loggedInStatus && embedConfig.detectCookieAccessSlow) {
            // When 3rd party cookie access is blocked, this will fail because
            // cookies will not be sent with the call.
            loggedInStatus = await isLoggedIn(thoughtSpotHost);
        }
    }
    return loggedInStatus;
};

/**
 * Validate embedConfig parameters required for cookielessTokenAuth
 *
 * @param embedConfig The embed configuration
 */
export const doCookielessTokenAuth = async (embedConfig: EmbedConfig): Promise<boolean> => {
    const { authEndpoint, getAuthToken } = embedConfig;
    if (!authEndpoint && !getAuthToken) {
        throw new Error('Either auth endpoint or getAuthToken function must be provided');
    }
    return Promise.resolve(true);
};

/**
 * Perform basic authentication to the ThoughtSpot cluster using the cluster
 * credentials.
 *
 * Warning: This feature is primarily intended for developer testing. It is
 * strongly advised not to use this authentication method in production.
 *
 * @param embedConfig The embed configuration
 */
export const doBasicAuth = async (embedConfig: EmbedConfig): Promise<boolean> => {
    const { thoughtSpotHost, username, password } = embedConfig;
    const loggedIn = await isLoggedIn(thoughtSpotHost);
    if (!loggedIn) {
        const response = await fetchBasicAuthService(thoughtSpotHost, username, password);
        loggedInStatus = response.ok;
        if (embedConfig.detectCookieAccessSlow) {
            loggedInStatus = await isLoggedIn(thoughtSpotHost);
        }
    } else {
        loggedInStatus = true;
    }
    return loggedInStatus;
};

/**
 *
 * @param ssoURL
 * @param triggerContainer
 * @param triggerText
 */
async function samlPopupFlow(ssoURL: string, triggerContainer: DOMSelector, triggerText: string) {
    const openPopup = () => {
        if (samlAuthWindow === null || samlAuthWindow.closed) {
            samlAuthWindow = window.open(
                ssoURL,
                '_blank',
                'location=no,height=570,width=520,scrollbars=yes,status=yes',
            );
        } else {
            samlAuthWindow.focus();
        }
    };
    authEE?.emit(AuthStatus.WAITING_FOR_POPUP);
    const containerEl = getDOMNode(triggerContainer);
    if (containerEl) {
        containerEl.innerHTML = '<button id="ts-auth-btn" class="ts-auth-btn" style="margin: auto;"></button>';
        const authElem = document.getElementById('ts-auth-btn');
        authElem.textContent = triggerText;
        authElem.addEventListener('click', openPopup, { once: true });
    }
    samlCompletionPromise = samlCompletionPromise
        || new Promise<void>((resolve, reject) => {
            window.addEventListener('message', (e) => {
                if (e.data.type === EmbedEvent.SAMLComplete) {
                    (e.source as Window).close();
                    resolve();
                }
            });
        });

    authEE?.once(AuthEvent.TRIGGER_SSO_POPUP, openPopup);
    return samlCompletionPromise;
}

/**
 * Perform SAML authentication
 *
 * @param embedConfig The embed configuration
 * @param ssoEndPoint
 */
const doSSOAuth = async (embedConfig: EmbedConfig, ssoEndPoint: string): Promise<void> => {
    const { thoughtSpotHost } = embedConfig;
    const loggedIn = await isLoggedIn(thoughtSpotHost);
    if (loggedIn) {
        if (isAtSSORedirectUrl()) {
            removeSSORedirectUrlMarker();
        }
        loggedInStatus = true;
        return;
    }

    // we have already tried authentication and it did not succeed, restore
    // the current URL to the original one and invoke the callback.
    if (isAtSSORedirectUrl()) {
        removeSSORedirectUrlMarker();
        loggedInStatus = false;
        return;
    }

    const ssoURL = `${thoughtSpotHost}${ssoEndPoint}`;
    if (embedConfig.inPopup) {
        await samlPopupFlow(
            ssoURL,
            embedConfig.authTriggerContainer,
            embedConfig.authTriggerText,
        );
        loggedInStatus = await isLoggedIn(thoughtSpotHost);
        return;
    }

    window.location.href = ssoURL;
};

export const doSamlAuth = async (embedConfig: EmbedConfig) => {
    const { thoughtSpotHost } = embedConfig;
    // redirect for SSO, when the SSO authentication is done, this page will be
    // loaded again and the same JS will execute again.
    const ssoRedirectUrl = embedConfig.inPopup
        ? `${thoughtSpotHost}/v2/#/embed/saml-complete`
        : getRedirectUrl(
            window.location.href,
            SSO_REDIRECTION_MARKER_GUID,
            embedConfig.redirectPath,
        );

    // bring back the page to the same URL
    const ssoEndPoint = `${EndPoints.SAML_LOGIN_TEMPLATE(encodeURIComponent(ssoRedirectUrl))}`;

    await doSSOAuth(embedConfig, ssoEndPoint);
    return loggedInStatus;
};

export const doOIDCAuth = async (embedConfig: EmbedConfig) => {
    const { thoughtSpotHost } = embedConfig;
    // redirect for SSO, when the SSO authentication is done, this page will be
    // loaded again and the same JS will execute again.
    const ssoRedirectUrl = embedConfig.noRedirect || embedConfig.inPopup
        ? `${thoughtSpotHost}/v2/#/embed/saml-complete`
        : getRedirectUrl(
            window.location.href,
            SSO_REDIRECTION_MARKER_GUID,
            embedConfig.redirectPath,
        );

    // bring back the page to the same URL
    const ssoEndPoint = `${EndPoints.OIDC_LOGIN_TEMPLATE(encodeURIComponent(ssoRedirectUrl))}`;

    await doSSOAuth(embedConfig, ssoEndPoint);
    return loggedInStatus;
};

export const logout = async (embedConfig: EmbedConfig): Promise<boolean> => {
    const { thoughtSpotHost } = embedConfig;
    const response = await fetchLogoutService(thoughtSpotHost);
    loggedInStatus = false;
    return loggedInStatus;
};

/**
 * Perform authentication on the ThoughtSpot cluster
 *
 * @param embedConfig The embed configuration
 */
export const authenticate = async (embedConfig: EmbedConfig): Promise<boolean> => {
    const { authType } = embedConfig;
    switch (authType) {
        case AuthType.SSO:
        case AuthType.SAMLRedirect:
        case AuthType.SAML:
            return doSamlAuth(embedConfig);
        case AuthType.OIDC:
        case AuthType.OIDCRedirect:
            return doOIDCAuth(embedConfig);
        case AuthType.AuthServer:
        case AuthType.TrustedAuthToken:
            return doTokenAuth(embedConfig);
        case AuthType.TrustedAuthTokenCookieless:
            return doCookielessTokenAuth(embedConfig);
        case AuthType.Basic:
            return doBasicAuth(embedConfig);
        default:
            return Promise.resolve(true);
    }
};

/**
 * Check if we are authenticated to the ThoughtSpot cluster
 */
export const isAuthenticated = (): boolean => loggedInStatus;
