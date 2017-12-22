var util = require('./util/util');
var validation = require('./util/validation');
var moment = require('moment-timezone');


module.exports = function(sequelize, DataTypes) {
  var name = 'Recording';

  var attributes = {
    // Raw file data.
    rawFileKey: DataTypes.STRING,
    rawFileSize: DataTypes.INTEGER,
    // Processing fields. Fields set by and for the processing.
    fileKey: DataTypes.STRING,
    fileSize: DataTypes.STRING,
    fileMimeType: DataTypes.STRING,
    processingStartTime: DataTypes.DATE,
    processingMeta: DataTypes.JSONB,
    processingState: DataTypes.STRING,
    passedFilter: DataTypes.BOOLEAN,
    // recording metadata.
    duration: DataTypes.INTEGER,
    recordingDateTime: DataTypes.DATE,
    location: {
      type: DataTypes.GEOMETRY,
      set: util.geometrySetter,
      validate: { isLatLon: validation.isLatLon },
    },
    version: DataTypes.STRING,
    // Battery relevant fields.
    batteryLevel: DataTypes.DOUBLE,
    batteryCharging: DataTypes.STRING,
    airplaneModeOn: DataTypes.BOOLEAN,
    // Other fields
    jobKey: DataTypes.STRING,
    type: DataTypes.STRING,
    public: { type: DataTypes.BOOLEAN, defaultValue: false},
    additionalMetadata: DataTypes.JSONB,
    comment: DataTypes.STRING,
  };

  var models = sequelize.models;

  /**
    * Return one or more recordings for a user matching the query
    * arguments given.
    */
  var query = async function(user, where, taggedOnly, offset, limit, order) {
    // If query should be filtered by tagged or not or ignored.
    var sqlLiteral = '';
    var tagRequired = false;
    if (taggedOnly == true) {
      tagRequired = true;
    } else if (taggedOnly == false) {
      sqlLiteral = 'NOT EXISTS (SELECT * FROM "Tags" WHERE  "Tags"."RecordingId" = "Recording".id)';
      tagRequired = false;
    }

    if (order == null) {
      order = [
        // Sort by recordingDatetime but handle the case of the
        // timestamp being missing and fallback to sorting by id.
        [sequelize.fn("COALESCE", sequelize.col('recordingDateTime'), '1970-01-01'), "DESC"],
        ["id", "DESC"],
      ];
    }

    var q = {
      where: {
        "$and": [
          where, // User query
          await recordingsFor(user),
          sequelize.literal(sqlLiteral),
        ],
      },
      order: order,
      include: [
        { model: models.Group },
        { model: models.Tag, required: tagRequired },
        { model: models.Device, where: {}, attributes: ["devicename", "id"] },
      ],
      limit: limit,
      offset: offset,
      attributes: userGetAttributes,
    };
    return this.findAndCount(q);
  }

  /**
   * Return a single recording for a user.
   */
  var getOne = async function(user, id) {
    var query = {
      where: {
        "$and": [
          { id: id },
          await recordingsFor(user),
        ],
      },
      include: [
        { model: models.Tag, },
        { model: models.Device, where: {}, attributes: ["devicename", "id"] },
      ],
      attributes: this.userGetAttributes.concat(['rawFileKey']),
    };

    return await this.findOne(query);
  };

  /**
   * Deletes a single recording if the user has permission to do so.
   */
  var deleteOne = async function(user, id) {
    var recording = await this.getOne(user, id);
    if (recording == null)
      return false;
    var userPermissions = await recording.getUserPermissions(user);
    if (userPermissions.canDelete != true) {
      return false;
    } else {
      await recording.destroy();
      return true;
    }
  };

  /**
   * Updates a single recording if the user has permission to do so.
   */
  var updateOne = async function(user, id, updates) {
    for (var key in updates) {
      if (apiUpdatableFields.indexOf(key) == -1) return false;
    }
    var recording = await this.getOne(user, id);
      if (recording == null) return false;
    var userPermissions = await recording.getUserPermissions(user);
    if (userPermissions.canUpdate != true) {
      return false;
    } else {
      await recording.update(updates);
      return true;
    }
  };

  var recordingsFor = async function(user) {
    var deviceIds = await user.getDeviceIds();
    var groupIds = await user.getGroupsIds();
    return await {"$or": [
      {public: true},
      {GroupId: {"$in": groupIds}},
      {DeviceId: {"$in": deviceIds}},
    ]};
  };

  var getRawFileName = function() {
    var ext = '';
    if (this.type == 'thermalRaw') {
      ext = '.cptv';
    }
    return moment.tz('Pacific/Auckland').format('YYYYMMDD-HHmmss') + ext;
  };

  var options = {
    classMethods: {
      addAssociations: addAssociations,
      query: query,
      getOne: getOne,
      deleteOne: deleteOne,
      updateOne: updateOne,
      processingAttributes: processingAttributes,
      processingStates: processingStates,
      apiSettableFields: apiSettableFields,
      userGetAttributes: userGetAttributes,
    },
    instanceMethods: {
      canGetRaw: canGetRaw,
      getFileName: getFileName,
      getRawFileName: getRawFileName,
      getUserPermissions: getUserPermissions,
    },
  };

  return sequelize.define(name, attributes, options);
}

/**
 * Returns JSON describing what the user can do to the recording.
 * Permission types: DELETE, TAG, VIEW,
 * //TODO This will be edited in the future when recordings can be public.
 */
function getUserPermissions(user) {
  // For now if the user is in the group that owns the recording they have all
  // permission. This will be changed in the future.
  var permissions = {
    canDelete: false,
    canTag: false,
    canView: false,
  }
  var recording = this;
  return new Promise(async (resolve, reject) => {
    var groupIds = await user.getGroupsIds();
    if (groupIds.indexOf(recording.GroupId) !== -1) {
      permissions.canDelete = true;
      permissions.canTag = true;
      permissions.canView = true;
      permissions.canUpdate = true;
    }
    return resolve(permissions);
  });
}

function canGetRaw() {
  if (this.get('type') == 'thermalRaw')
    return true;
  return false;
}

function getFileName() {
  var ext = "";
  if (this.fileMimeType == 'video/mp4') ext = ".mp4"
  return moment(new Date(this.recordingDateTime)).tz("Pacific/Auckland")
    .format("YYYYMMDD-HHmmss") + ext;
}

var userGetAttributes = [
  'id',
  'rawFileSize',
  'fileSize',
  'fileMimeType',
  'processingState',
  'duration',
  'recordingDateTime',
  'location',
  'version',
  'batteryLevel',
  'batteryCharging',
  'airplaneModeOn',
  'type',
  'additionalMetadata',
  'GroupId',
  'fileKey',
  'comment',
];

var apiSettableFields = [
  'type',
  'duration',
  'recordingDateTime',
  'location',
  'version',
  'batteryCharging',
  'batteryLevel',
  'airplaneModeOn',
  'additionalMetadata',
  'processingMeta',
  'comment',
];

var apiUpdatableFields = [
  'location',
  'comment',
];

var processingStates = {
  thermalRaw: ['toMp4', 'FINISHED'],
}

var processingAttributes = [
  'id',
  'rawFileKey',
  'fileKey',
  'processingMeta',
  'processingState',
  'jobKey',
  'type',
];

function addAssociations(models) {
  models.Recording.belongsTo(models.Group);
  models.Recording.belongsTo(models.Device);
  models.Recording.hasMany(models.Tag);
}