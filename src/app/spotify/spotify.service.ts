import { APIURLS } from './../api-urls.enum';
import { API } from './../http/http.service';
import { Injectable } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { BehaviorSubject } from 'rxjs';
import { environment } from 'src/environments/environment';

@Injectable({
  providedIn: 'root'
})
export class SpotifyService {
  // Public Properties
  public userPlaylists = new BehaviorSubject<any>([]);
  public selectedPlaylists = new BehaviorSubject<any>([]);
  public unfollowedPlaylists = new BehaviorSubject<any>([]);
  public tracks = new BehaviorSubject<any>([]);
  public globalFilter = new BehaviorSubject<any>('');
  public filteredTracks = new BehaviorSubject<any>({});
  // Private Properties
  private cachedSelectedPlaylistIds: string[] = [];
  private authorizationRedirect: string;
  private redirectUrl = environment.production
    ? 'https://sjb-2-ui.herokuapp.com/dashboard'
    : 'http://localhost:4200/dashboard';
  public get spotifyAuth() {
    return JSON.parse(sessionStorage.getItem('spotifyAuth'));
  }
  constructor(private authService: AuthService) {
    this.setAuthRedirect();
    this.selectedPlaylists.subscribe(playlists =>
      this.onSelectedPlaylistsChange(playlists)
    );
  }
  public requestAuth() {
    window.location.href = this.authorizationRedirect;
  }
  public setUser(user) {
    const spotifyAuth = this.spotifyAuth;
    spotifyAuth.user = user;
    sessionStorage.setItem('spotifyAuth', JSON.stringify(spotifyAuth));
  }
  public getUserPlaylists(): Promise<any> {
    const storedPlaylists = sessionStorage.getItem('userPlaylists');
    if (
      storedPlaylists &&
      storedPlaylists.length &&
      storedPlaylists.length > 0
    ) {
      return Promise.resolve(
        JSON.parse(sessionStorage.getItem('userPlaylists'))
      );
    } else {
      return this.fetchUserPlaylists()
        .then(response => {
          const filteredPlaylists = response.data;
          sessionStorage.setItem(
            'userPlaylists',
            JSON.stringify(filteredPlaylists)
          );
          return filteredPlaylists;
        })
        .catch(console.log);
    }
  }

  // API REQUESTS
  public requestToken(code) {
    return API.post(APIURLS.spotifyToken, {
      code,
      redirect_uri: this.redirectUrl,
      spotifyAuth: this.spotifyAuth
    });
  }
  public getUserInfo() {
    const storedUser =
      sessionStorage.getItem('spotifyAuth') &&
      JSON.parse(sessionStorage.getItem('spotifyAuth')).user;
    return storedUser
      ? Promise.resolve(JSON.parse(storedUser))
      : API.get(APIURLS.spotifyUser);
  }

  public fetchUserPlaylists() {
    return API.get(APIURLS.userPlaylists).then(playlists => {
      return playlists;
    });
  }
  public fetchPlaylistTracks(id) {
    // NOT CACHED ~ cached in onSelectedPlaylistsChange
    return API.get(APIURLS.playlistTracks.replace(':id', id)).then(tracks => {
      return tracks;
    });
  }
  public refactorPlaylist(id, body) {
    return API.post(APIURLS.playlistRefactor.replace(':id', id), body).then(
      response => {
        this.refreshPlaylistData();
      }
    );
  }
  public createPlaylist(tracks, name) {
    return API.post(APIURLS.playlist.replace('/:id', ''), {
      tracks,
      name
    }).then(response => {
      this.refreshPlaylistData();
    });
  }
  public unfollowPlaylist(id) {
    return API.delete(APIURLS.playlist.replace(':id', id)).then(response => {
      this.refreshPlaylistData();
    });
  }
  public unfollowPlaylists(ids) {
    return API.post(APIURLS.playlistUnfollowMulti, { ids }).then(response => {
      this.unfollowedPlaylists.next(ids);
      this.refreshPlaylistData();
    });
  }
  public followPlaylists(ids) {
    return API.post(APIURLS.playlistFollowMulti, { ids }).then(response => {
      this.unfollowedPlaylists.next([]);
      this.refreshPlaylistData();
    });
  }
  public refreshPlaylistData() {
    sessionStorage.removeItem('userPlaylists');
    this.getUserPlaylists().then(playlists => {
      this.userPlaylists.next(playlists);
      this.selectedPlaylists.next([]);
    });
  }
  private setAuthRedirect() {
    const options = {
      response_type: 'code',
      client_id: '77e9ad1b69544cdd9c18f516f4988e13',
      scope:
        // tslint:disable-next-line:max-line-length
        'user-read-private user-read-recently-played user-top-read playlist-modify-public streaming playlist-modify-private playlist-read-private',
      redirect_uri: this.redirectUrl,
      state: this.authService.token
    };
    const params = new URLSearchParams();
    for (const key in options) {
      if (key) {
        params.set(key, options[key]);
      }
    }
    this.authorizationRedirect =
      'https://accounts.spotify.com/authorize?' + params.toString();
  }
  private onSelectedPlaylistsChange(playlists) {
    const playlistIds = playlists.map(playlist => playlist.id);
    if (this.cachedSelectedPlaylistIds.length > playlists.length) {
      // Negative diff
      this.trimDeselectedPlaylistTracks(playlistIds);
    } else {
      // Positive Diff
      this.updateTracksWithNewlySelectedPlaylistTracks(playlistIds, playlists);
    }
    this.cachedSelectedPlaylistIds = playlistIds;
  }
  private trimDeselectedPlaylistTracks(ids) {
    const removedPlaylistIds = this.cachedSelectedPlaylistIds.filter(id => {
      if (ids.indexOf(id) === -1) {
        return id;
      }
    });
    const currentTracks = this.tracks.getValue();
    for (const id of removedPlaylistIds) {
      delete currentTracks[id];
    }
    this.tracks.next(currentTracks);
  }
  private updateTracksWithNewlySelectedPlaylistTracks(ids, playlists) {
    const addedPlaylistIds = ids.filter(
      id => this.cachedSelectedPlaylistIds.indexOf(id) === -1
    );
    const oversizedPlaylistIds = playlists
      .filter(playlist => playlist.numTracks > 100 && playlist.id)
      .map(obj => obj.id);
    const resolved = [];
    const newTracks = {};
    addedPlaylistIds.map(id => {
      if (oversizedPlaylistIds.indexOf(id) > -1) {
        // Playlist too big to fetch all tracks and details in one go, force playlist refactor before proceeding.
        newTracks[id] = [];
        resolved.push(Promise.resolve());
      } else {
        const promise = this.fetchPlaylistTracks(id).then(response => {
          newTracks[id] = response.data;
        });
        resolved.push(promise);
      }
    });
    if (resolved.length > 0) {
      Promise.all(resolved).then(() => {
        const currentTracks = this.tracks.getValue();
        this.tracks.next(Object.assign(currentTracks, newTracks));
      });
    }
  }
}
