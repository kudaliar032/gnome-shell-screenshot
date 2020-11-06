import * as St from '@imports/St-1.0';
import * as Cogl from '@imports/Cogl-7';
import * as Clutter from '@imports/Clutter-7';

import { currentVersion } from '../gselib/version';
import { openPrefs } from '../gselib/openPrefs';

import * as Config from './config';
import * as Extension from './extension';
import { Screenshot } from './screenshot';
import ExtensionUtils from './extensionUtils';
import { _ } from '../gettext';

const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Slider = imports.ui.slider;

const Local = ExtensionUtils.getCurrentExtension();

const version = currentVersion();

const DefaultIcon = 'camera-photo-symbolic';

const settings = ExtensionUtils.getSettings();

// remove this when dropping support for < 3.33
const getActorCompat = (obj) => (version.greaterEqual('3.33') ? obj : obj.actor);

const getSliderSignalCompat = () => (version.greaterEqual('3.33') ? 'notify::value' : 'value-changed');

const addActorCompat = (actor, child) =>
  version.greaterEqual('3.36') ? actor.add_child(child) : actor.add(child, { expand: true });

declare interface CaptureDelayMenu extends St.Widget {}

class CaptureDelayMenu extends PopupMenu.PopupMenuSection {
  createScale() {
    const scale = [0];
    for (let p = 1; p < 4; p++) {
      for (let x = 1; x <= 10; x += 1) {
        scale.push(x * Math.pow(10, p));
      }
    }
    return scale;
  }

  constructor(_control?) {
    super();

    this.scaleMS = this.createScale();

    this.delayValueMS = settings.get_int(Config.KeyCaptureDelay);
    this.slider = new Slider.Slider(this.scaleToSlider(this.delayValueMS));
    this.slider.connect(getSliderSignalCompat(), this.onDragEnd.bind(this));
    this.sliderItem = new PopupMenu.PopupBaseMenuItem({ activate: false });

    addActorCompat(getActorCompat(this.sliderItem), getActorCompat(this.slider));
    this.addMenuItem(this.sliderItem);

    this.delayInfoItem = new PopupMenu.PopupMenuItem('', { activate: false, hover: false, can_focus: false });
    this.addMenuItem(this.delayInfoItem);

    this.updateDelayInfo();
  }

  scaleToSlider(ms) {
    return this.scaleMS.findIndex((v) => v >= ms) / (this.scaleMS.length - 1);
  }

  sliderToScale(value) {
    return this.scaleMS[(value * (this.scaleMS.length - 1)) | 0];
  }

  onDragEnd(slider) {
    const newValue = this.sliderToScale(slider.value);
    if (newValue !== this.delayValueMS) {
      this.delayValueMS = newValue;
      settings.set_int(Config.KeyCaptureDelay, newValue);
      this.updateDelayInfo();
    }
  }

  updateDelayInfo() {
    const v = this.delayValueMS;
    let text;
    if (v === 0) {
      text = _('No Capture Delay');
    } else if (v < 1000) {
      text = `${v}ms ` + _('Capture Delay');
    } else {
      text = `${v / 1000}s ` + _('Capture Delay');
    }
    this.delayInfoItem.label.text = text;
  }
}

interface PopupMenuItem extends St.BoxLayout {
  menu: {
    addMenuItem(v: St.Widget);
  };
}

class ScreenshotSection {
  private _screenshot?: Screenshot;

  private _image: PopupMenuItem;
  private _clear: PopupMenuItem;
  private _copy: PopupMenuItem;
  private _save: PopupMenuItem;
  private _imgurMenu: PopupMenuItem;
  private _imgurUpload: PopupMenuItem;
  private _imgurOpen: PopupMenuItem;
  private _imgurCopyLink: PopupMenuItem;
  private _imgurDelete: PopupMenuItem;

  constructor(menu) {
    this._image = new PopupMenu.PopupBaseMenuItem();
    getActorCompat(this._image).content_gravity = Clutter.ContentGravity.RESIZE_ASPECT;

    this._clear = new PopupMenu.PopupMenuItem(_('Clear'));
    this._copy = new PopupMenu.PopupMenuItem(_('Copy'));
    this._save = new PopupMenu.PopupMenuItem(_('Save As...'));

    this._image.connect('activate', this._onImage.bind(this));
    this._clear.connect('activate', this._onClear.bind(this));
    this._copy.connect('activate', this._onCopy.bind(this));
    this._save.connect('activate', this._onSave.bind(this));

    menu.addMenuItem(this._image);
    menu.addMenuItem(this._clear);
    menu.addMenuItem(this._copy);
    menu.addMenuItem(this._save);

    // IMGUR

    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    this._imgurMenu = new PopupMenu.PopupSubMenuMenuItem(_('Imgur'), false);
    this._imgurUpload = new PopupMenu.PopupMenuItem(_('Upload'));
    this._imgurOpen = new PopupMenu.PopupMenuItem(_('Open Link'));
    this._imgurCopyLink = new PopupMenu.PopupMenuItem(_('Copy Link'));
    this._imgurDelete = new PopupMenu.PopupMenuItem(_('Delete'));

    this._imgurUpload.connect('activate', this._onImgurUpload.bind(this));
    this._imgurOpen.connect('activate', this._onImgurOpen.bind(this));
    this._imgurCopyLink.connect('activate', this._onImgurCopyLink.bind(this));
    this._imgurDelete.connect('activate', this._onImgurDelete.bind(this));

    this._imgurMenu.menu.addMenuItem(this._imgurUpload);
    this._imgurMenu.menu.addMenuItem(this._imgurOpen);
    this._imgurMenu.menu.addMenuItem(this._imgurCopyLink);
    this._imgurMenu.menu.addMenuItem(this._imgurDelete);

    menu.addMenuItem(this._imgurMenu);

    menu.connect('open-state-changed', () => {
      this._updateVisibility();
    });

    this._updateVisibility();
  }

  _updateVisibility() {
    const visible = !!this._screenshot;

    getActorCompat(this._image).visible = visible;
    getActorCompat(this._clear).visible = visible;
    getActorCompat(this._copy).visible = visible;
    getActorCompat(this._save).visible = visible;

    const imgurEnabled = settings.get_boolean(Config.KeyEnableUploadImgur);
    const imgurComplete = this._screenshot && this._screenshot.imgurUpload && this._screenshot.imgurUpload.responseData;

    getActorCompat(this._imgurMenu).visible = visible && imgurEnabled;
    getActorCompat(this._imgurUpload).visible = visible && imgurEnabled && !imgurComplete;
    getActorCompat(this._imgurOpen).visible = visible && imgurEnabled && imgurComplete;
    getActorCompat(this._imgurCopyLink).visible = visible && imgurEnabled && imgurComplete;
    getActorCompat(this._imgurDelete).visible = visible && imgurEnabled && imgurComplete;
  }

  _setImage(pixbuf) {
    const { width, height } = pixbuf;
    if (height == 0) {
      return;
    }
    const image = new Clutter.Image();
    const success = image.set_data(
      pixbuf.get_pixels(),
      pixbuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888,
      width,
      height,
      pixbuf.get_rowstride(),
    );
    if (!success) {
      throw Error('error creating Clutter.Image()');
    }

    getActorCompat(this._image).content = image;
    getActorCompat(this._image).height = 200;
  }

  setScreenshot(screenshot: Screenshot | undefined) {
    this._screenshot = screenshot;

    if (this._screenshot) {
      this._setImage(this._screenshot.gtkImage.get_pixbuf());
      this._screenshot.connect('imgur-upload', (obj, upload) => {
        upload.connect('done', (_obj, _data) => {
          this._updateVisibility();
        });
      });
    }

    this._updateVisibility();
  }

  get screenshot(): Screenshot {
    if (!this._screenshot) {
      throw new Error('screenshot not set');
    }
    return this._screenshot;
  }

  _onImage() {
    this.screenshot.launchOpen();
  }

  _onClear() {
    this.setScreenshot(undefined);
  }

  _onCopy() {
    this.screenshot.copyClipboard(settings.get_string(Config.KeyCopyButtonAction));
  }

  _onSave() {
    this.screenshot.launchSave();
  }

  _onImgurUpload() {
    this.screenshot.imgurStartUpload();
  }

  _onImgurOpen() {
    this.screenshot.imgurOpenURL();
  }

  _onImgurCopyLink() {
    this.screenshot.imgurCopyURL();
  }

  _onImgurDelete() {
    this.screenshot.imgurDelete();
  }
}

export class Indicator {
  private _extension: Extension.Extension;
  public panelButton: St.Button & { menu: any };
  private _screenshotSection?: ScreenshotSection;

  constructor(extension) {
    this._extension = extension;

    this.panelButton = new PanelMenu.Button(null, Config.IndicatorName);
    const icon = new St.Icon({
      icon_name: DefaultIcon,
      style_class: 'system-status-icon',
    });
    getActorCompat(this.panelButton).add_actor(icon);
    getActorCompat(this.panelButton).connect('button-press-event', this._onClick.bind(this));

    this._buildMenu();
  }

  _onClick(obj, evt) {
    // only override primary button behavior
    if (evt.get_button() !== Clutter.BUTTON_PRIMARY) {
      return;
    }

    const action = settings.get_string(Config.KeyClickAction);
    if (action === 'show-menu') {
      return;
    }

    this.panelButton.menu.close();
    this._extension.onAction(action);
  }

  _buildMenu() {
    // These actions can be triggered via shortcut or popup menu
    const menu = this.panelButton.menu;
    const items = [
      ['select-area', _('Select Area')],
      ['select-window', _('Select Window')],
      ['select-desktop', _('Select Desktop')],
    ];

    items.forEach(([action, title]) => {
      const item = new PopupMenu.PopupMenuItem(title);
      item.connect('activate', () => {
        menu.close();
        this._extension.onAction(action);
      });
      menu.addMenuItem(item);
    });

    // Delay

    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    menu.addMenuItem(new CaptureDelayMenu());

    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    this._screenshotSection = new ScreenshotSection(menu);

    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    // Settings can only be triggered via menu
    const settingsItem = new PopupMenu.PopupMenuItem(_('Settings'));
    settingsItem.connect('activate', () => {
      openPrefs(version, Local.metadata.uuid, { shell: imports.gi.Shell });
    });
    menu.addMenuItem(settingsItem);
  }

  setScreenshot(screenshot) {
    if (!this._screenshotSection) {
      throw new Error();
    }
    this._screenshotSection.setScreenshot(screenshot);
  }

  destroy() {
    this.panelButton.destroy();
  }
}